import { chromium } from 'playwright'
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import JSZip from 'jszip'
import { spawn } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const code = await downloadAndUnzipVSCode('1.95.0')
const userDataDir = await mkdtemp(path.join(tmpdir(), 'visual-auto-build-'))
const extensionsDir = path.join(userDataDir, 'extensions')
const workspaceDir = path.join(userDataDir, 'workspace')
const fixture = path.join(workspaceDir, 'visual-auto-build.tex')
const pdf = path.join(workspaceDir, 'visual-auto-build.pdf')

await mkdir(path.join(userDataDir, 'User'), { recursive: true })
await mkdir(extensionsDir, { recursive: true })
await mkdir(workspaceDir, { recursive: true })
await writeFile(
  path.join(userDataDir, 'User', 'settings.json'),
  JSON.stringify({
    'extensions.autoCheckUpdates': false,
    'extensions.autoUpdate': false,
    'latex-workshop.latex.autoBuild.run': 'onFileChange',
    'latex-workshop.latex.autoBuild.interval': 300,
  })
)
await writeFile(
  fixture,
  String.raw`\documentclass{article}
\begin{document}
Visual auto build before
\end{document}
`
)
await installLatexWorkshop()

const codeEnvironment = { ...process.env }
delete codeEnvironment.ELECTRON_RUN_AS_NODE
let codeErrors = ''
const debuggingPort = 9335
const codeProcess = spawn(
  code,
  [
    `--remote-debugging-port=${debuggingPort}`,
    '--new-window',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-updates',
    '--disable-workspace-trust',
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    `--extensionDevelopmentPath=${root}`,
    fixture,
  ],
  { env: codeEnvironment, stdio: ['ignore', 'ignore', 'pipe'] }
)
codeProcess.stderr.on('data', chunk => {
  codeErrors += chunk
})

let browser
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    browser = await chromium.connectOverCDP(
      `http://127.0.0.1:${debuggingPort}`
    )
    break
  } catch {
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}
if (!browser) throw new Error('Could not connect Playwright to VS Code')

try {
  const window = await waitForWindow(browser)
  await window.locator('.monaco-workbench').waitFor({ timeout: 60_000 })
  const sourceTab = window
    .locator('.tabs-container .tab')
    .filter({ hasText: 'visual-auto-build.tex' })
  await sourceTab.waitFor({ state: 'visible', timeout: 30_000 })
  await window
    .locator('.editor-actions [aria-label*="Build LaTeX project"]')
    .waitFor({ state: 'visible', timeout: 60_000 })

  const sourceEditor = window.locator('.editor-instance .monaco-editor').last()
  await sourceEditor.locator('.view-lines').click()
  await window.keyboard.press('Control+Alt+B')
  await waitForFile(pdf, 90_000)
  const initialPdfTime = (await stat(pdf)).mtimeMs

  await window
    .locator('.editor-actions [aria-label="Toggle Visual Editor"]')
    .first()
    .click()
  const frame = await findFrameWithSelector(window, '.cm-content')
  if (!frame) throw new Error('Visual editor content frame was not created')

  const line = frame.locator('.cm-line').filter({ hasText: 'before' })
  await line.click({ force: true })
  await line.press('End')
  await frame.locator('.cm-content').pressSequentially(' after')
  await frame
    .locator('.cm-line')
    .filter({ hasText: 'before after' })
    .waitFor({ state: 'visible', timeout: 5_000 })

  await waitForSourceText(fixture, 'before after', 15_000)
  if (!(await waitForFileNewer(pdf, initialPdfTime, 90_000))) {
    throw new Error('Visual edit was saved but did not rebuild the PDF')
  }
  console.log('Visual edits save and trigger LaTeX Workshop auto-build.')
} finally {
  await browser.close()
  codeProcess.kill()
}

async function installLatexWorkshop() {
  const version = '10.0.0'
  const response = await fetch(
    `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/James-Yu/vsextensions/latex-workshop/${version}/vspackage`
  )
  if (!response.ok) {
    throw new Error(`Could not download LaTeX Workshop: ${response.status}`)
  }
  const archive = await JSZip.loadAsync(await response.arrayBuffer())
  const destination = path.join(
    extensionsDir,
    `james-yu.latex-workshop-${version}`
  )
  await Promise.all(
    Object.values(archive.files)
      .filter(entry => !entry.dir && entry.name.startsWith('extension/'))
      .map(async entry => {
        const relativePath = entry.name.slice('extension/'.length)
        const outputPath = path.join(destination, relativePath)
        await mkdir(path.dirname(outputPath), { recursive: true })
        await writeFile(outputPath, await entry.async('nodebuffer'))
      })
  )
}

async function waitForWindow(browser) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const window = browser.contexts().flatMap(context => context.pages())[0]
    if (window) return window
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`VS Code did not create a workbench page: ${codeErrors}`)
}

async function waitForFile(file, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      await stat(file)
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  throw new Error(`Timed out waiting for ${path.basename(file)}`)
}

async function waitForFileNewer(file, previousTime, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      if ((await stat(file)).mtimeMs > previousTime) return true
    } catch {
      // The compiler may briefly replace the output file.
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return false
}

async function waitForSourceText(file, expected, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if ((await readFile(file, 'utf8')).includes(expected)) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Visual edit was not saved to the source file')
}

async function findFrameWithSelector(window, selector) {
  for (let attempt = 0; attempt < 120; attempt++) {
    for (const frame of window.frames()) {
      if (await frame.locator(selector).count().catch(() => 0)) return frame
    }
    await window.waitForTimeout(250)
  }
}

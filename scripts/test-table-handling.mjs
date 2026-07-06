import { chromium } from 'playwright'
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { spawn } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const useSystemVSCode = process.argv.includes('--system-vscode')
const code = useSystemVSCode
  ? path.join(
      process.env.LOCALAPPDATA,
      'Programs',
      'Microsoft VS Code',
      'Code.exe'
    )
  : await downloadAndUnzipVSCode('1.95.0')
const userDataDir = await mkdtemp(path.join(tmpdir(), 'table-handling-'))
const extensionsDir = path.join(userDataDir, 'extensions')
const fixture = path.join(userDataDir, 'table-handling.tex')
const filler = Array.from(
  { length: 60 },
  (_, index) => `Filler line ${index + 1}.\\\\`
).join('\n')
await mkdir(path.join(userDataDir, 'User'), { recursive: true })
await mkdir(extensionsDir, { recursive: true })
await writeFile(
  path.join(userDataDir, 'User', 'settings.json'),
  JSON.stringify({
    'extensions.autoCheckUpdates': false,
    'extensions.autoUpdate': false,
    'latexVisualEditor.useOverleafKeybindings': true,
  })
)
await writeFile(
  fixture,
  String.raw`\documentclass{article}
\begin{document}
Before the table.

${filler}

\begin{table}
  \centering
  \begin{tabular}{cc}
    A & $x^2$ \\
    C & D \\
  \end{tabular}
  \caption{A test table.}
  \label{tab:test}
\end{table}

After the table.
\end{document}
`
)

const codeEnvironment = { ...process.env }
delete codeEnvironment.ELECTRON_RUN_AS_NODE
let codeErrors = ''
const debuggingPort = useSystemVSCode ? 9337 : 9336
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
  const browserErrors = []
  window.on('pageerror', error => browserErrors.push(String(error)))
  window.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  await window.locator('.monaco-workbench').waitFor({ timeout: 60_000 })
  const sourceTab = window
    .locator('.tabs-container .tab')
    .filter({ hasText: 'table-handling.tex' })
  await sourceTab.waitFor({ state: 'visible', timeout: 30_000 })
  await window
    .locator('.editor-actions [aria-label="Toggle Visual Editor"]')
    .first()
    .click()

  const frame = await findFrameWithSelector(window, '.cm-content')
  if (!frame) throw new Error('Visual editor content frame was not created')
  await frame.locator('.cm-scroller').evaluate(element => {
    element.scrollTop = element.scrollHeight
    element.dispatchEvent(new Event('scroll'))
  })
  const table = frame.locator('.table-generator-table')
  await table.waitFor({ state: 'visible', timeout: 30_000 })
  const caption = frame.locator('.table-generator-caption')
  await caption.waitFor({ state: 'visible', timeout: 5_000 })
  if ((await caption.textContent())?.trim() !== 'A test table.') {
    throw new Error('The visual table caption was not rendered')
  }
  const cells = table.locator('tbody .table-generator-cell')

  const mathCell = cells.nth(1)
  await mathCell.locator('mjx-container').waitFor({ timeout: 10_000 })
  await mathCell.click()
  await mathCell.locator('textarea').press('Escape')
  await mathCell.locator('mjx-container').waitFor({ timeout: 10_000 })

  await cells.first().click()
  await frame
    .locator('.table-generator-floating-toolbar')
    .waitFor({ state: 'visible', timeout: 5_000 })
  const toolbarIcons = frame.locator(
    '.table-generator-floating-toolbar .material-symbols'
  )
  await toolbarIcons.first().waitFor({ state: 'visible', timeout: 5_000 })
  const iconRendering = await toolbarIcons.evaluateAll(elements => ({
    fontLoaded: document.fonts.check('20px "Material Symbols Rounded"'),
    fontFamilies: elements.map(
      element => getComputedStyle(element).fontFamily
    ),
    widths: elements.map(element => element.getBoundingClientRect().width),
  }))
  if (
    !iconRendering.fontLoaded ||
    iconRendering.fontFamilies.some(
      family => !family.includes('Material Symbols Rounded')
    ) ||
    iconRendering.widths.some(width => width > 32)
  ) {
    throw new Error(
      `Table toolbar Material Symbols did not render correctly: ${JSON.stringify(iconRendering)}`
    )
  }
  if (process.env.TABLE_HANDLING_SCREENSHOT) {
    await frame.locator('.table-generator-floating-toolbar').screenshot({
      path: process.env.TABLE_HANDLING_SCREENSHOT,
    })
  }
  await cells.first().locator('textarea').press('Escape')
  if ((await frame.locator('#table-generator-show-help').count()) !== 0) {
    throw new Error('Table toolbar still contains the removed Help button')
  }
  await frame.locator('#table-generator-caption-dropdown').click()
  const captionAboveOption = frame.locator('#table-generator-caption-above')
  const captionOptionReceivesPointer = await captionAboveOption.evaluate(
    element => {
      const rect = element.getBoundingClientRect()
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      )
      return hit !== null && element.contains(hit)
    }
  )
  if (!captionOptionReceivesPointer) {
    throw new Error('Table menu item is clipped or blocked from pointer input')
  }
  await captionAboveOption.click()
  await frame.locator('.table-generator-table').waitFor({
    state: 'visible',
    timeout: 10_000,
  })
  await window.keyboard.press('Control+S')
  await waitForCaptionPosition(fixture, 'above', 15_000)

  const tableAfterCaptionMove = frame.locator('.table-generator-table')
  const cellsAfterCaptionMove = tableAfterCaptionMove.locator(
    'tbody .table-generator-cell'
  )
  await cellsAfterCaptionMove.first().click()
  await cellsAfterCaptionMove.first().locator('textarea').press('Escape')
  await frame.locator('#table-generator-caption-dropdown').click()
  await frame.locator('#table-generator-caption-below').click()
  await frame.locator('.table-generator-table').waitFor({
    state: 'visible',
    timeout: 10_000,
  })
  await window.keyboard.press('Control+S')
  await waitForCaptionPosition(fixture, 'below', 15_000)

  await selectCell(cells.first())
  await cells.first().press('Control+C')
  await window.waitForTimeout(500)
  await window.keyboard.press('Control+Shift+P')
  const commandInput = window.locator(
    '.quick-input-widget input[placeholder="Type the name of a command to run."]'
  )
  await commandInput.waitFor({ state: 'visible', timeout: 10_000 })
  await commandInput.press('Control+V')
  const copiedText = await commandInput.inputValue()
  if (copiedText.replace(/^>\s*/, '').trim() !== 'A') {
    throw new Error(
      `Ctrl+C did not copy the selected table cell (received ${JSON.stringify(copiedText)})`
    )
  }
  await window.keyboard.press('Escape')

  await frame.locator('[data-column-selector="0"]').click({ force: true })
  await frame.locator('#format_text_wrap').click()
  await frame.locator('#table-generator-wrap-text').click()
  const widthDialog = frame.locator('.table-generator-width-modal')
  await widthDialog.waitFor({ state: 'visible', timeout: 5_000 })
  await widthDialog.locator('button', { hasText: 'Cancel' }).click()
  await widthDialog.waitFor({ state: 'hidden', timeout: 5_000 })
  await table.scrollIntoViewIfNeeded()
  const scrollTopBeforeAction = await frame
    .locator('.cm-scroller')
    .evaluate(element => element.scrollTop)
  if (scrollTopBeforeAction < 100) {
    throw new Error('Table scroll regression test did not reach a scrolled view')
  }
  await frame
    .locator('#table-generator-add-dropdown')
    .click({ force: true })
  await frame
    .locator('#table-generator-insert-column-right')
    .click({ force: true })

  try {
    await table.waitFor({ state: 'visible', timeout: 10_000 })
  } catch (error) {
    await window.keyboard.press('Control+S')
    await window.waitForTimeout(500)
    const diagnostics = {
      tableCount: await frame.locator('.table-generator-table').count(),
      tabularCount: await frame.locator('.ol-cm-tabular').count(),
      errorCount: await frame.locator('.table-generator-error-container').count(),
      activeLine: await frame.locator('.cm-activeLine').allTextContents(),
      editorText: (await frame.locator('.cm-content').innerText()).slice(0, 2000),
      editorHtml: (await frame.locator('.cm-content').innerHTML()).slice(0, 6000),
      source: await readFile(fixture, 'utf8'),
      browserErrors,
    }
    console.error(JSON.stringify(diagnostics, null, 2))
    throw error
  }
  await frame.waitForTimeout(500)
  if ((await frame.locator('.table-generator-table').count()) !== 1) {
    throw new Error('Adding a column collapsed the visual table')
  }
  const scrollTopAfterAction = await frame
    .locator('.cm-scroller')
    .evaluate(element => element.scrollTop)
  if (scrollTopAfterAction < scrollTopBeforeAction - 100) {
    throw new Error(
      `Adding a column scrolled the editor upward (${scrollTopBeforeAction} -> ${scrollTopAfterAction})`
    )
  }
  await window.keyboard.press('Control+S')
  await waitForSourceText(fixture, '\\begin{tabular}{clc}', 15_000)

  const updatedTable = frame.locator('.table-generator-table')
  const updatedCells = updatedTable.locator('tbody .table-generator-cell')
  await selectCell(updatedCells.first())
  await updatedCells.first().press('Delete')
  await updatedTable.waitFor({ state: 'visible', timeout: 10_000 })
  await window.keyboard.press('Control+S')
  await waitForSourceText(fixture, '\\begin{tabular}{lc}', 15_000)

  const sourceBeforeColumnDelete = await readFile(fixture, 'utf8')
  await frame.locator('[data-column-selector="1"]').click({ force: true })
  await frame.locator('[data-column-selector="1"]').press('Delete')
  const scrollTopBeforeUndo = await frame
    .locator('.cm-scroller')
    .evaluate(element => element.scrollTop)
  await window.keyboard.press('Control+z')
  await waitForExactSource(fixture, sourceBeforeColumnDelete, 10_000)
  await frame.waitForTimeout(500)
  const scrollTopAfterUndo = await frame
    .locator('.cm-scroller')
    .evaluate(element => element.scrollTop)
  if (Math.abs(scrollTopAfterUndo - scrollTopBeforeUndo) > 5) {
    throw new Error(
      `Undoing a keyboard table deletion moved the editor viewport (${scrollTopBeforeUndo} -> ${scrollTopAfterUndo})`
    )
  }

  const tableTrigger = frame.locator('#toolbar-table')
  await tableTrigger.click()
  const sizePopup = frame.locator('#toolbar-table-menu')
  await sizePopup.waitFor({ state: 'visible', timeout: 5_000 })
  const gridCells = sizePopup.locator('.toolbar-table-grid-cell')
  if ((await gridCells.count()) !== 100) {
    throw new Error('Table size popup did not contain a 10 by 10 grid')
  }
  const threeByFour = sizePopup.locator(
    '[data-columns="4"][data-rows="3"]'
  )
  await threeByFour.hover()
  if (
    (await sizePopup.locator('.toolbar-table-size-label').textContent()) !==
    'Insert 3×4 table'
  ) {
    throw new Error('Table size popup did not preview the hovered dimensions')
  }
  await threeByFour.click()
  await sizePopup.waitFor({ state: 'hidden', timeout: 5_000 })
  await window.keyboard.press('Control+S')
  await waitForSourceText(fixture, '\\begin{tabular}{cccc}', 15_000)
  const sourceAfterGeneration = await readFile(fixture, 'utf8')
  const generatedBody = sourceAfterGeneration.match(
    /\\begin\{tabular\}\{cccc\}([\s\S]*?)\\end\{tabular\}/
  )?.[1]
  if (!generatedBody || (generatedBody.match(/\\\\/g) ?? []).length !== 3) {
    throw new Error('The 3 by 4 table grid selection inserted the wrong size')
  }

  console.log(
    'Table math restoration, responsive toolbar buttons/dialogs, generator grid, caption, Ctrl+C, structural Delete and undo, menu insertion, expansion, and scroll preservation passed.'
  )
} finally {
  await browser.close()
  codeProcess.kill()
}

async function waitForWindow(browserInstance) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const window = browserInstance.contexts().flatMap(context => context.pages())[0]
    if (window) return window
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`VS Code did not create a workbench page: ${codeErrors}`)
}

async function selectCell(cell) {
  await cell.dispatchEvent('mousedown', {
    bubbles: true,
    button: 0,
    clientX: 0,
    clientY: 0,
  })
  await cell.dispatchEvent('mousemove', {
    bubbles: true,
    buttons: 1,
    clientX: 10,
    clientY: 0,
  })
  await cell.dispatchEvent('mouseup', {
    bubbles: true,
    button: 0,
    clientX: 10,
    clientY: 0,
  })
}

async function findFrameWithSelector(window, selector) {
  for (let attempt = 0; attempt < 120; attempt++) {
    for (const frame of window.frames()) {
      if (await frame.locator(selector).count().catch(() => 0)) return frame
    }
    await window.waitForTimeout(250)
  }
}

async function waitForSourceText(file, expected, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if ((await readFile(file, 'utf8')).includes(expected)) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Source did not contain ${expected}`)
}

async function waitForExactSource(file, expected, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if ((await readFile(file, 'utf8')) === expected) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Source was not restored after undo')
}

async function waitForCaptionPosition(file, expected, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const source = await readFile(file, 'utf8')
    const caption = source.indexOf('\\caption{A test table.}')
    const tabularStart = source.indexOf('\\begin{tabular}')
    const tabularEnd = source.indexOf('\\end{tabular}')
    const matches =
      expected === 'above'
        ? caption >= 0 && caption < tabularStart
        : caption > tabularEnd
    if (matches) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Caption did not move ${expected}`)
}

import { buildParserFile } from '@lezer/generator'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const directory = path.resolve(
  'src/webview/overleaf-editor/lezer-latex'
)
const grammarPath = path.join(directory, 'latex.grammar')
const grammar = await readFile(grammarPath, 'utf8')
const output = buildParserFile(grammar, {
  fileName: grammarPath,
  moduleStyle: 'es',
})

await Promise.all([
  writeFile(path.join(directory, 'latex.mjs'), output.parser),
  writeFile(path.join(directory, 'latex.terms.mjs'), output.terms),
])

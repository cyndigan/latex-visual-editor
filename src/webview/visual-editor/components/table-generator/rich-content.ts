import { EditorState } from '@codemirror/state'
import { parser } from '../../lezer-latex/latex.mjs'
import { typesetNodeIntoElement } from '../../extensions/visual/utils/typeset-content'
import { generateTable, validateParsedTable, type ParsedTableData } from './utils'

export type TabularWrapper = {
  content: string
  prefix: string
  suffix: string
}

/** Returns the editable contents of a tabular environment that fills a cell. */
export function unwrapSingleTabular(source: string): TabularWrapper | null {
  const tree = parser.parse(source)
  let wrapper: TabularWrapper | null = null
  tree.iterate({
    enter(nodeRef) {
      if (nodeRef.type.name !== 'TabularEnvironment') return
      if (source.slice(0, nodeRef.from).trim() || source.slice(nodeRef.to).trim()) {
        return false
      }
      const content = nodeRef.node.getChild('Content')?.getChild('TabularContent')
      if (!content) return false
      wrapper = {
        content: source.slice(content.from, content.to),
        prefix: source.slice(0, content.from),
        suffix: source.slice(content.to),
      }
      return false
    },
  })
  return wrapper
}

export function renderTableCellContent(source: string, element: HTMLElement) {
  element.replaceChildren()
  const tree = parser.parse(source)
  const state = EditorState.create({ doc: source })
  let nested = false
  tree.iterate({
    enter(nodeRef) {
      if (nested) return false
      if (nodeRef.type.name !== 'TabularEnvironment') return
      try {
        const parsed = generateTable(nodeRef.node, state)
        if (!validateParsedTable(parsed)) return
        renderStaticTable(parsed, element)
        nested = true
        return false
      } catch {
        return
      }
    },
  })
  if (!nested) {
    typesetNodeIntoElement(tree.topNode, element, source.substring.bind(source))
  }
}

function renderStaticTable(parsed: ParsedTableData, element: HTMLElement) {
  const table = document.createElement('table')
  table.className = 'latex-visual-table latex-visual-nested-table'
  for (const row of parsed.table.rows) {
    const tr = table.insertRow()
    for (const cell of row.cells) {
      const td = tr.insertCell()
      td.colSpan = cell.multiColumn?.columnSpan ?? 1
      renderTableCellContent(cell.content, td)
    }
  }
  element.append(table)
}

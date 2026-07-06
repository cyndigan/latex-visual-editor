import { isolateHistory } from '@codemirror/commands'
import type { ChangeSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  BorderTheme,
  type ColumnDefinition,
  type TableData,
} from './table-model'
import type { TableSelection } from './table-selection'
import {
  parseColumnSpecifications,
  type ParsedTableData,
  type TableEnvironmentData,
} from './utils'
import type { WidthSelection } from './toolbar/column-width-modal/column-width'

export { BorderTheme }

export type TablePositions = ParsedTableData & {
  tabular: { from: number; to: number }
}

export function generateColumnSpecification(
  columns: ColumnDefinition[]
): string {
  return columns
    .map(
      column =>
        `${'|'.repeat(column.borderLeft)}${column.cellSpacingLeft}${
          column.customCellDefinition
        }${column.content}${column.cellSpacingRight}${'|'.repeat(
          column.borderRight
        )}`
    )
    .join('')
}

type ThemeGenerator = {
  column: (
    index: number,
    count: number
  ) => { left: boolean; right: boolean }
  row: (index: number) => string | false
  lastRow?: () => string | false
  multicolumn: () => { left: boolean; right: boolean }
}

const borderThemes: Record<BorderTheme, ThemeGenerator> = {
  [BorderTheme.NO_BORDERS]: {
    column: () => ({ left: false, right: false }),
    row: () => false,
    multicolumn: () => ({ left: false, right: false }),
  },
  [BorderTheme.FULLY_BORDERED]: {
    column: (index, count) => ({ left: true, right: index === count - 1 }),
    row: () => '\\hline',
    lastRow: () => '\\hline',
    multicolumn: () => ({ left: true, right: true }),
  },
  [BorderTheme.BOOKTABS]: {
    column: () => ({ left: false, right: false }),
    row: index =>
      index === 0 ? '\\toprule' : index === 1 ? '\\midrule' : false,
    lastRow: () => '\\bottomrule',
    multicolumn: () => ({ left: false, right: false }),
  },
}

export function setBorders(
  view: EditorView,
  theme: BorderTheme,
  positions: TablePositions,
  table: TableData
): void {
  const generator = borderThemes[theme]
  const changes: ChangeSpec[] = []
  const specification = view.state.sliceDoc(
    positions.specification.from,
    positions.specification.to
  )
  const columns = parseColumnSpecifications(specification)
  columns.forEach((column, index) => {
    const border = generator.column(index, columns.length)
    column.borderLeft = border.left ? 1 : 0
    column.borderRight = border.right ? 1 : 0
  })
  changes.push({
    from: positions.specification.from,
    to: positions.specification.to,
    insert: generateColumnSpecification(columns),
  })

  positions.rowPositions.forEach((row, index) => {
    const desired = generator.row(index)
    const separator = positions.rowSeparators[index]
    const topRules = row.hlines.filter(line => !separator || line.from <= separator.to)
    if (desired) {
      if (topRules.length) {
        changes.push({
          ...topRules[0],
          insert: view.state.sliceDoc(topRules[0].from, topRules[0].to).trim() === desired
            ? view.state.sliceDoc(topRules[0].from, topRules[0].to)
            : desired,
        })
        topRules.slice(1).forEach(rule => changes.push({ ...rule, insert: '' }))
      } else {
        changes.push({ from: row.from, to: row.from, insert: desired })
      }
    } else {
      topRules.forEach(rule => changes.push({ ...rule, insert: '' }))
    }
  })

  const lastIndex = positions.rowPositions.length - 1
  const last = positions.rowPositions[lastIndex]
  const lastSeparator = positions.rowSeparators[lastIndex]
  const bottomRules = last.hlines.filter(
    line => !lastSeparator || line.from >= lastSeparator.to
  )
  const desiredBottom = generator.lastRow?.()
  if (desiredBottom) {
    if (bottomRules.length) {
      changes.push({ ...bottomRules[0], insert: desiredBottom })
      bottomRules.slice(1).forEach(rule => changes.push({ ...rule, insert: '' }))
    } else if (lastSeparator) {
      changes.push({
        from: lastSeparator.to,
        to: lastSeparator.to,
        insert: ` ${desiredBottom}`,
      })
    } else {
      changes.push({ from: last.to, to: last.to, insert: `\\\\ ${desiredBottom}` })
    }
  } else {
    bottomRules.forEach(rule => changes.push({ ...rule, insert: '' }))
  }

  for (const row of table.rows) {
    for (const cell of row.cells) {
      if (!cell.multiColumn) continue
      const border = generator.multicolumn()
      const multicolumns = parseColumnSpecifications(
        view.state.sliceDoc(
          cell.multiColumn.columns.from,
          cell.multiColumn.columns.to
        )
      )
      multicolumns.forEach(column => {
        column.borderLeft = border.left ? 1 : 0
        column.borderRight = border.right ? 1 : 0
      })
      changes.push({
        from: cell.multiColumn.columns.from,
        to: cell.multiColumn.columns.to,
        insert: generateColumnSpecification(multicolumns),
      })
    }
  }
  view.dispatch({ changes })
}

const paragraphAlignment: Record<ColumnDefinition['alignment'], string> = {
  left: '\\raggedright',
  right: '\\raggedleft',
  center: '\\centering',
  paragraph: '',
}

function paragraphPrefix(alignment: ColumnDefinition['alignment']): string {
  return alignment === 'paragraph'
    ? ''
    : `>{${paragraphAlignment[alignment]}\\arraybackslash}`
}

export function setAlignment(
  view: EditorView,
  selection: TableSelection,
  alignment: ColumnDefinition['alignment'],
  positions: TablePositions,
  table: TableData
): void {
  if (selection.isMergedCellSelected(table)) {
    if (alignment === 'paragraph') return
    const { minX, minY } = selection.normalized()
    const cell = table.getCell(minY, minX)
    if (!cell.multiColumn) return
    const columns = parseColumnSpecifications(
      view.state.sliceDoc(
        cell.multiColumn.columns.from,
        cell.multiColumn.columns.to
      )
    )
    columns.forEach(column => {
      column.alignment = alignment
      column.content = alignment[0]
    })
    view.dispatch({
      changes: {
        from: cell.multiColumn.columns.from,
        to: cell.multiColumn.columns.to,
        insert: generateColumnSpecification(columns),
      },
    })
    return
  }

  const columns = parseColumnSpecifications(
    view.state.sliceDoc(positions.specification.from, positions.specification.to)
  )
  const { minX, maxX } = selection.normalized()
  for (let index = minX; index <= maxX; index++) {
    if (!selection.isColumnSelected(index, table)) continue
    columns[index].alignment = alignment
    if (columns[index].isParagraphColumn) {
      columns[index].customCellDefinition = paragraphPrefix(alignment)
    } else if (alignment !== 'paragraph') {
      columns[index].content = alignment[0]
    }
  }
  view.dispatch({
    changes: {
      from: positions.specification.from,
      to: positions.specification.to,
      insert: generateColumnSpecification(columns),
    },
  })
}

export function insertRow(
  view: EditorView,
  selection: TableSelection,
  positions: TablePositions,
  below: boolean,
  table: TableData
): void {
  const { minY, maxY } = selection.normalized()
  const at = below
    ? positions.rowPositions[maxY].to
    : positions.rowPositions[minY].from
  const border = table.getBorderTheme() === BorderTheme.FULLY_BORDERED
    ? '\\hline'
    : ''
  const needsInitialBreak =
    below && positions.rowSeparators.length === table.rows.length - 1
      ? '\\\\'
      : ''
  const initialBorder =
    !below && minY === 0 && border ? '\\hline' : ''
  const row = `\n${' &'.repeat(table.columns.length - 1)}\\\\${border}`
  view.dispatch({
    changes: {
      from: at,
      to: at,
      insert: `${needsInitialBreak}${initialBorder}${row.repeat(
        selection.height()
      )}`,
    },
  })
}

export function insertColumn(
  view: EditorView,
  initialSelection: TableSelection,
  positions: TablePositions,
  after: boolean,
  table: TableData
): void {
  const selection = initialSelection.explode(table)
  const { minX, maxX } = selection.normalized()
  const count = selection.maximumCellWidth(table)
  const targetColumn = after ? maxX : minX
  const changes: ChangeSpec[] = []

  for (let row = 0; row < table.rows.length; row++) {
    const cell = table.getCell(row, targetColumn)
    const target = cell.multiColumn ?? cell
    const at = after ? target.to : target.from
    changes.push({ from: at, to: at, insert: ' &'.repeat(count) })
  }

  const columns = parseColumnSpecifications(
    view.state.sliceDoc(positions.specification.from, positions.specification.to)
  )
  const bordered = table.getBorderTheme() === BorderTheme.FULLY_BORDERED
  const at = after ? maxX + 1 : minX
  columns.splice(
    at,
    0,
    ...Array.from({ length: count }, (): ColumnDefinition => ({
      alignment: 'left',
      borderLeft: 0,
      borderRight: bordered ? 1 : 0,
      content: 'l',
      cellSpacingLeft: '',
      cellSpacingRight: '',
      customCellDefinition: '',
      isParagraphColumn: false,
    }))
  )
  if (at === 0 && bordered) columns[0].borderLeft = 1
  changes.push({
    from: positions.specification.from,
    to: positions.specification.to,
    insert: generateColumnSpecification(columns),
  })
  view.dispatch({ changes })
}

export function removeRowsOrColumns(
  view: EditorView,
  selection: TableSelection,
  positions: TablePositions,
  table: TableData
): void {
  const expanded = selection.explode(table)
  const { minX, maxX, minY, maxY } = expanded.normalized()
  const removesRows = expanded.isAnyRowSelected(table)
  const removesColumns = expanded.isAnyColumnSelected(table)
  if (!removesRows && !removesColumns) return

  if (expanded.spansEntireTable(table)) {
    const firstColumn = { ...table.columns[0], borderLeft: 0, borderRight: 0 }
    view.dispatch({
      annotations: isolateHistory.of('full'),
      changes: [
        {
          from: positions.specification.from,
          to: positions.specification.to,
          insert: generateColumnSpecification([firstColumn]),
        },
        {
          from: positions.rowPositions[0].from,
          to: positions.rowPositions.at(-1)!.to,
          insert: '\\\\',
        },
      ],
    })
    return
  }

  const changes: ChangeSpec[] = []
  for (let row = minY; row <= maxY; row++) {
    if (expanded.isRowSelected(row, table)) {
      changes.push({ ...positions.rowPositions[row], insert: '' })
      continue
    }
    if (!removesColumns) continue
    const firstIndex = table.getCellIndex(row, minX)
    const lastIndex = table.getCellIndex(row, maxX)
    const first = positions.cellPositions[row][firstIndex]
    const last = positions.cellPositions[row][lastIndex]
    if (firstIndex === 0) {
      const separator = positions.cellSeparators[row][lastIndex]
      changes.push({
        from: first.from,
        to: separator?.to ?? last.to,
        insert: '',
      })
    } else {
      changes.push({
        from: positions.cellSeparators[row][firstIndex - 1].from,
        to: last.to,
        insert: '',
      })
    }
  }

  if (removesColumns) {
    const columns = parseColumnSpecifications(
      view.state.sliceDoc(
        positions.specification.from,
        positions.specification.to
      )
    ).filter((_, index) => index < minX || index > maxX)
    if (
      table.getBorderTheme() === BorderTheme.FULLY_BORDERED &&
      columns.length
    ) {
      columns[0].borderLeft = 1
    }
    changes.push({
      from: positions.specification.from,
      to: positions.specification.to,
      insert: generateColumnSpecification(columns),
    })
  }
  view.dispatch({ annotations: isolateHistory.of('full'), changes })
}

export function mergeCells(
  view: EditorView,
  selection: TableSelection,
  table: TableData
): void {
  if (!selection.isMergeableCells(table)) return
  const { minX, maxX, minY } = selection.normalized()
  const content: string[] = []
  for (let column = minX; column <= maxX; column++) {
    content.push(table.getCell(minY, column).content.trim())
  }
  const border =
    table.getBorderTheme() === BorderTheme.FULLY_BORDERED ? '|' : ''
  view.dispatch({
    changes: {
      from: table.getCell(minY, minX).from,
      to: table.getCell(minY, maxX).to,
      insert: `\\multicolumn{${maxX - minX + 1}}{${border}c${border}}{${content
        .join(' ')
        .trim()}}`,
    },
  })
}

export function unmergeCells(
  view: EditorView,
  selection: TableSelection,
  table: TableData
): void {
  const cell = table.getCell(selection.from.row, selection.from.cell)
  if (!cell.multiColumn) return
  view.dispatch({
    changes: [
      { ...cell.multiColumn.preamble, insert: '' },
      {
        ...cell.multiColumn.postamble,
        insert: '&'.repeat(cell.multiColumn.columnSpan - 1),
      },
    ],
  })
}

function widthSuffix(width: WidthSelection, current?: WidthSelection): string {
  if (width.unit === 'custom') return ''
  if (width.unit === '%') {
    return `\\${
      current?.unit === '%' && current.command
        ? current.command
        : 'linewidth'
    }`
  }
  return width.unit
}

export function setColumnWidth(
  view: EditorView,
  selection: TableSelection,
  width: WidthSelection,
  positions: TablePositions,
  table: TableData
): void {
  const columns = parseColumnSpecifications(
    view.state.sliceDoc(positions.specification.from, positions.specification.to)
  )
  const { minX, maxX } = selection.normalized()
  for (let index = minX; index <= maxX; index++) {
    if (!selection.isColumnSelected(index, table)) continue
    const value =
      width.unit === 'custom'
        ? width.width
        : `${width.unit === '%' ? width.width / 100 : width.width}${widthSuffix(
            width,
            table.columns[index].size
          )}`
    const character = ['p', 'm', 'b'].includes(columns[index].content[0])
      ? columns[index].content[0]
      : 'p'
    columns[index].customCellDefinition = paragraphPrefix(
      columns[index].alignment
    )
    columns[index].content = `${character}{${value}}`
  }
  view.dispatch({
    changes: {
      from: positions.specification.from,
      to: positions.specification.to,
      insert: generateColumnSpecification(columns),
    },
  })
}

export function removeColumnWidths(
  view: EditorView,
  selection: TableSelection,
  positions: TablePositions,
  table: TableData
): void {
  const columns = parseColumnSpecifications(
    view.state.sliceDoc(positions.specification.from, positions.specification.to)
  )
  const { minX, maxX } = selection.normalized()
  for (let index = minX; index <= maxX; index++) {
    if (!selection.isColumnSelected(index, table)) continue
    columns[index].customCellDefinition = ''
    if (columns[index].alignment === 'paragraph') {
      columns[index].alignment = 'left'
    }
    columns[index].content = columns[index].alignment[0]
  }
  view.dispatch({
    changes: {
      from: positions.specification.from,
      to: positions.specification.to,
      insert: generateColumnSpecification(columns),
    },
  })
}

function contains(
  outer: { from: number; to: number },
  inner: { from: number; to: number }
): boolean {
  return outer.from <= inner.from && outer.to >= inner.to
}

function emptyLineInsertion(
  view: EditorView,
  position: number,
  direction: 'above' | 'below'
) {
  let at = position
  let prefix = ''
  let suffix = ''
  const line = view.state.doc.lineAt(position)
  if (line.text.trim()) {
    if (direction === 'below') {
      at = Math.min(line.to + 1, view.state.doc.length)
      if (view.state.doc.lineAt(at).length) suffix = '\n'
    } else {
      at = Math.max(line.from - 1, 0)
      if (view.state.doc.lineAt(at).length) prefix = '\n'
    }
  }
  return { at, prefix, suffix }
}

export function moveCaption(
  view: EditorView,
  positions: TablePositions,
  target: 'above' | 'below',
  environment?: TableEnvironmentData
): void {
  const desiredPosition =
    target === 'above' ? positions.tabular.from : positions.tabular.to
  if (
    environment?.caption &&
    ((target === 'above' &&
      environment.caption.from < positions.tabular.from) ||
      (target === 'below' && environment.caption.from > positions.tabular.to))
  ) {
    return
  }
  const insertion = emptyLineInsertion(view, desiredPosition, target)
  const changes: ChangeSpec[] = []
  let content = '\\caption{Caption}\n\\label{tab:my_table}'
  if (environment?.caption) {
    content = view.state.sliceDoc(
      environment.caption.from,
      environment.caption.to
    )
    if (
      environment.label &&
      !contains(environment.caption, environment.label)
    ) {
      content += `\n${view.state.sliceDoc(
        environment.label.from,
        environment.label.to
      )}`
      changes.push({ ...environment.label, insert: '' })
    }
    changes.push({ ...environment.caption, insert: '' })
  } else if (environment?.label) {
    content = `\\caption{Caption}\n${view.state.sliceDoc(
      environment.label.from,
      environment.label.to
    )}`
    changes.push({ ...environment.label, insert: '' })
  }
  changes.push({
    from: insertion.at,
    to: insertion.at,
    insert: `${insertion.prefix}${content}${insertion.suffix}`,
  })
  view.dispatch({ changes })
}

export function removeCaption(
  view: EditorView,
  environment?: TableEnvironmentData
): void {
  if (!environment?.caption) return
  const changes: ChangeSpec[] = [{ ...environment.caption, insert: '' }]
  if (
    environment.label &&
    !contains(environment.caption, environment.label)
  ) {
    changes.push({ ...environment.label, insert: '' })
  }
  view.dispatch({ changes })
}

export function removeTable(
  view: EditorView,
  positions: TablePositions,
  environment?: TableEnvironmentData
): void {
  const range = environment?.table ?? positions.tabular
  view.dispatch({ changes: { ...range, insert: '' } })
  view.focus()
}

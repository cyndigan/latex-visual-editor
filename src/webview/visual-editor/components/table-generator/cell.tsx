import { useEffect, useRef } from 'react'
import { loadMathJax } from '../../../mathjax/load-mathjax'
import type { CellData, ColumnDefinition } from './table-model'
import { renderTableCellContent } from './rich-content'
import { CellInput } from './cell-input'
import { useTableContext } from './contexts/table-context'
import { useTableSelection } from './contexts/selection-context'
import { useTableEditing } from './contexts/editing-context'

export function Cell({
  cell,
  column,
  rowIndex,
  cellIndex,
  fromColumn,
  rowLength,
  borderTop,
  borderBottom,
}: {
  cell: CellData
  column: ColumnDefinition
  rowIndex: number
  cellIndex: number
  fromColumn: number
  rowLength: number
  borderTop: number
  borderBottom: number
}) {
  const { view, parsed } = useTableContext()
  const selectionState = useTableSelection()
  const editingState = useTableEditing()
  const renderRef = useRef<HTMLDivElement>(null)
  const cellRef = useRef<HTMLTableCellElement>(null)
  const width = cell.multiColumn?.columnSpan ?? 1
  const toColumn = fromColumn + width - 1
  const editing =
    editingState.editing?.row === rowIndex &&
    editingState.editing.cellIndex === cellIndex
  const selected = Boolean(
    selectionState.selection?.contains(rowIndex, fromColumn, parsed.table)
  )
  const bounds = selectionState.selection?.normalized()

  useEffect(() => {
    if (editing || !renderRef.current) return
    const element = renderRef.current
    let cancelled = false
    renderTableCellContent(cell.content.trim(), element)
    void loadMathJax()
      .then(async MathJax => {
        if (cancelled || !element.isConnected) return
        await MathJax.typesetPromise([element])
        if (cancelled || !element.isConnected) return
        view.requestMeasure()
        MathJax.typesetClear([element])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [cell.content, editing, view])

  useEffect(() => {
    if (
      !editing &&
      !selectionState.dragging &&
      selectionState.selection?.to.row === rowIndex &&
      fromColumn <= selectionState.selection.to.cell &&
      toColumn >= selectionState.selection.to.cell
    ) {
      cellRef.current?.focus({ preventScroll: true })
      document.getSelection()?.removeAllRanges()
    }
  }, [
    editing,
    fromColumn,
    selectionState.dragging,
    selectionState.selection,
    rowIndex,
    toColumn,
  ])

  useEffect(() => {
    if (selectionState.dragging) document.getSelection()?.removeAllRanges()
  }, [selectionState.dragging, selectionState.selection])

  const classes = [
    'table-generator-cell',
    `alignment-${column.alignment}`,
    column.borderLeft > 0 && 'table-generator-cell-border-left',
    column.borderRight > 0 && 'table-generator-cell-border-right',
    borderTop > 0 && 'table-generator-row-border-top',
    borderBottom > 0 && 'table-generator-row-border-bottom',
    selected && 'selected',
    editing && 'editing',
    selected && rowIndex === bounds?.minY && 'selection-edge-top',
    selected && rowIndex === bounds?.maxY && 'selection-edge-bottom',
    selected && fromColumn === bounds?.minX && 'selection-edge-left',
    selected && toColumn === bounds?.maxX && 'selection-edge-right',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <td
      ref={cellRef}
      colSpan={width}
      tabIndex={rowIndex * rowLength + cellIndex + 1}
      className={classes}
      onMouseDown={event => {
        if (!editing) selectionState.pointerDown(event, rowIndex, fromColumn, toColumn)
      }}
      onMouseMove={event => {
        if (!editing) selectionState.pointerMove(event, rowIndex, fromColumn)
      }}
      onMouseUp={() => {
        if (!editing) selectionState.pointerUp(rowIndex, cellIndex, cell.content.trim())
      }}
    >
      {editing ? (
        <CellInput />
      ) : (
        <div ref={renderRef} className="table-generator-cell-render" />
      )}
    </td>
  )
}

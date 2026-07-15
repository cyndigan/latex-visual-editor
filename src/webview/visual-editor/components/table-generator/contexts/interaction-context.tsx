import { isolateHistory, redo, undo } from '@codemirror/commands'
import { EditorSelection, type SelectionRange } from '@codemirror/state'
import { toggleRanges } from '../../../commands/ranges'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type RefObject,
} from 'react'
import { TableSelection } from '../table-selection'
import { unwrapSingleTabular } from '../rich-content'
import {
  deleteTableSelectionChanges,
  pasteTableChanges,
  selectedTableText,
} from '../selection-operations'
import { useTableContext } from './table-context'
import {
  EditingContext,
  type EditingCell,
  type EditingContextValue,
} from './editing-context'
import {
  SelectionContext,
  type SelectionContextValue,
} from './selection-context'

type PointerStart = {
  x: number
  y: number
  row: number
  fromColumn: number
  toColumn: number
}

type TableFormattingState = {
  bold: boolean
  italic: boolean
}

let activeTable: HTMLElement | null = null
const persistedSelections = new WeakMap<HTMLElement, TableSelection>()
const persistedSelectionsByPosition = new Map<number, TableSelection>()
const DRAG_THRESHOLD = 4

export function TableInteractionProvider({
  wrapperRef,
  children,
}: PropsWithChildren<{ wrapperRef: RefObject<HTMLDivElement | null> }>) {
  const { view, parsed, positions, environment } = useTableContext()
  const model = parsed.table
  const selectionKey = positions.tabular.from
  const [selectionState, setSelectionState] = useState<TableSelection | null>(
    () => {
      const wrapper = wrapperRef.current
      return (
        persistedSelectionsByPosition.get(selectionKey)?.explode(model) ??
        (wrapper ? persistedSelections.get(wrapper)?.explode(model) ?? null : null)
      )
    }
  )
  const [editing, setEditing] = useState<EditingCell | null>(null)
  const editingRef = useRef<EditingCell | null>(null)
  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)
  const pointer = useRef<PointerStart | null>(null)
  const exitOnMouseUp = useRef(false)

  const selectedText = useCallback(
    (selection: TableSelection) => selectedTableText(selection, model),
    [model]
  )

  const selectedFormatting = useCallback(
    (selection: TableSelection): TableFormattingState => {
      const { minX, maxX, minY, maxY } = selection.normalized()
      const isFormatted = (command: '\\textbf' | '\\textit') => {
        let hasCells = false
        let formatted = true
        model.iterateCells(minY, maxY, minX, maxX, cell => {
          hasCells = true
          const content = cell.content.trim()
          if (!content.startsWith(`${command}{`) || !content.endsWith('}')) {
            formatted = false
          }
        })
        return hasCells && formatted
      }
      return { bold: isFormatted('\\textbf'), italic: isFormatted('\\textit') }
    },
    [model]
  )

  const setSelection = useCallback(
    (next: TableSelection | null) => {
      const exploded = next?.explode(model) ?? null
      setSelectionState(exploded)
      const wrapper = wrapperRef.current
      if (exploded) {
        persistedSelectionsByPosition.set(selectionKey, exploded)
        if (wrapper) persistedSelections.set(wrapper, exploded)
      } else {
        persistedSelectionsByPosition.delete(selectionKey)
        if (wrapper) persistedSelections.delete(wrapper)
      }
      activeTable = exploded ? wrapperRef.current : null
      window.dispatchEvent(
        new CustomEvent('table-selection-changed', {
          detail: exploded
            ? { text: selectedText(exploded), formatting: selectedFormatting(exploded) }
            : { text: undefined },
        })
      )
    },
    [model, selectedFormatting, selectedText, selectionKey, wrapperRef]
  )

  const keepExpanded = useCallback(() => {
    const range = environment?.table ?? positions.tabular
    const current = view.state.selection.main
    if (current.to < range.from || current.from > range.to) return
    const position =
      range.from > 0
        ? range.from - 1
        : Math.min(view.state.doc.length, range.to + 1)
    view.dispatch({ selection: EditorSelection.cursor(position) })
  }, [environment, positions.tabular, view])

  const commitEditing = useCallback(() => {
    const current = editingRef.current
    if (!current) return
    editingRef.current = null
    setEditing(null)
    const content = current.wrapper
      ? `${current.wrapper.prefix}${current.content}${current.wrapper.suffix}`
      : current.content
    if (view.state.readOnly || content === current.initial) return
    const position = parsed.cellPositions[current.row]?.[current.cellIndex]
    if (!position) return
    keepExpanded()
    view.dispatch({
      changes: { ...position, insert: content },
      userEvent: 'input',
    })
  }, [keepExpanded, parsed.cellPositions, view])

  const cancelEditing = useCallback(() => {
    editingRef.current = null
    setEditing(null)
  }, [])
  const startEditing = useCallback(
    (
      row: number,
      cellIndex: number,
      source: string,
      initial: string = source
    ) => {
      if (view.state.readOnly) return
      if (editingRef.current) commitEditing()
      const wrapper = unwrapSingleTabular(source)
      const content = initial === source ? (wrapper?.content ?? source) : initial
      const next = {
        row,
        cellIndex,
        content,
        initial: source,
        wrapper: wrapper
          ? { prefix: wrapper.prefix, suffix: wrapper.suffix }
          : undefined,
      }
      editingRef.current = next
      setEditing(next)
    },
    [commitEditing, view.state.readOnly]
  )
  const updateDraft = useCallback(
    (content: string) => {
      const current = editingRef.current
      if (!current) return
      const next = { ...current, content }
      editingRef.current = next
      setEditing(next)
    },
    []
  )

  const selectRow = useCallback(
    (row: number, extend: boolean) =>
      setSelection(
        selectionState
          ? selectionState.selectRow(row, extend, model)
          : new TableSelection(
              { row, cell: 0 },
              { row, cell: model.columns.length - 1 }
            )
      ),
    [model, selectionState, setSelection]
  )
  const selectColumn = useCallback(
    (column: number, extend: boolean) =>
      setSelection(
        selectionState
          ? selectionState.selectColumn(column, extend, model)
          : new TableSelection(
              { row: 0, cell: column },
              { row: model.rows.length - 1, cell: column }
            )
      ),
    [model, selectionState, setSelection]
  )

  const pointerDown = useCallback(
    (event: React.MouseEvent, row: number, fromColumn: number, toColumn: number) => {
      if (event.button !== 0) return
      event.preventDefault()
      document.getSelection()?.removeAllRanges()
      activeTable = wrapperRef.current
      wrapperRef.current?.focus({ preventScroll: true })
      pointer.current = {
        x: event.clientX,
        y: event.clientY,
        row,
        fromColumn,
        toColumn,
      }
    },
    [wrapperRef]
  )
  const pointerMove = useCallback(
    (event: React.MouseEvent, row: number, fromColumn: number) => {
      const start = pointer.current
      if (!start || event.buttons !== 1) return
      if (!draggingRef.current) {
        const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y)
        if (distance < DRAG_THRESHOLD && row === start.row && fromColumn === start.fromColumn) {
          return
        }
        draggingRef.current = true
        setDragging(true)
        setSelection(
          new TableSelection(
            { row: start.row, cell: start.fromColumn },
            { row: start.row, cell: start.toColumn }
          )
        )
      }
      event.preventDefault()
      document.getSelection()?.removeAllRanges()
      setSelection(
        new TableSelection(
          { row: start.row, cell: start.fromColumn },
          { row, cell: fromColumn }
        )
      )
    },
    [setSelection]
  )
  const pointerUp = useCallback(
    (row: number, cellIndex: number, source: string) => {
      if (!pointer.current) return
      const wasDragging = draggingRef.current
      pointer.current = null
      draggingRef.current = false
      setDragging(false)
      if (!wasDragging) {
        const bounds = model.getCellBoundaries(row, model.rows[row].cells
          .slice(0, cellIndex)
          .reduce((sum, cell) => sum + (cell.multiColumn?.columnSpan ?? 1), 0))
        setSelection(new TableSelection({ row, cell: bounds.from }))
        startEditing(row, cellIndex, source)
      }
    },
    [model, setSelection, startEditing]
  )

  const deleteSelection = useCallback(() => {
    const selection = selectionState
    if (!selection || view.state.readOnly) return
    const changes = deleteTableSelectionChanges(selection, model, positions)
    setSelection(null)
    keepExpanded()
    view.dispatch({
      annotations: isolateHistory.of('full'),
      changes,
      userEvent: 'delete',
    })
    view.focus?.()
    window.dispatchEvent(
      new CustomEvent('table-mutated', {
        detail: { ...(environment?.table ?? positions.tabular) },
      })
    )
  }, [
    environment,
    keepExpanded,
    model,
    positions,
    selectionState,
    setSelection,
    view,
  ])

  const pasteText = useCallback(
    (text: string) => {
      if (!selectionState || !text || view.state.readOnly) return
      const changes = pasteTableChanges(text, selectionState, model)
      if (changes.length) {
        keepExpanded()
        view.dispatch({ changes, userEvent: 'input.paste' })
      }
    },
    [keepExpanded, model, selectionState, view]
  )

  const dispatchCommand = useCallback(
    (command: () => void) => {
      editingRef.current = null
      setEditing(null)
      keepExpanded()
      command()
      view.focus?.()
      window.dispatchEvent(
        new CustomEvent('table-mutated', {
          detail: { ...(environment?.table ?? positions.tabular) },
        })
      )
    },
    [environment, keepExpanded, positions.tabular, view]
  )

  const toggleSelectedCells = useCallback(
    (command: '\\textbf' | '\\textit') => {
      if (!selectionState || view.state.readOnly) return false
      const { minX, maxX, minY, maxY } = selectionState.normalized()
      const ranges: SelectionRange[] = []
      model.iterateCells(minY, maxY, minX, maxX, cell => {
        ranges.push(EditorSelection.range(cell.from, cell.to))
      })
      if (!ranges.length) return false

      keepExpanded()
      for (const range of ranges.reverse()) {
        view.dispatch({ selection: EditorSelection.create([range]) })
        toggleRanges(command)(view)
      }
      keepExpanded()
      window.dispatchEvent(
        new CustomEvent('table-mutated', {
          detail: { ...(environment?.table ?? positions.tabular) },
        })
      )
      return true
    },
    [
      environment,
      keepExpanded,
      model,
      positions,
      selectionState,
      view,
    ]
  )

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        if (
          activeTable === wrapper &&
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === 'z'
        ) {
          window.dispatchEvent(
            new CustomEvent('table-mutated', {
              detail: { ...(environment?.table ?? positions.tabular) },
            })
          )
        }
        return
      }
      if (activeTable !== wrapper || !selectionState ||
          wrapper.querySelector('.table-generator-dialog-backdrop')) return
      const command = event.ctrlKey || event.metaKey
      const lower = event.key.toLowerCase()
      if (command && !event.altKey && (lower === 'b' || lower === 'i')) {
        if (editing) return
        if (toggleSelectedCells(lower === 'b' ? '\\textbf' : '\\textit')) {
          event.preventDefault(); event.stopPropagation()
        }
        return
      }
      if (editing) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault(); event.stopPropagation(); deleteSelection(); return
      }
      if (command && !event.altKey) {
        if (lower === 'a') {
          event.preventDefault(); event.stopPropagation()
          setSelection(new TableSelection(
            { row: 0, cell: 0 },
            { row: model.rows.length - 1, cell: model.columns.length - 1 }
          ))
        } else if (lower === 'c') {
          event.preventDefault(); event.stopPropagation()
          void navigator.clipboard.writeText(selectedText(selectionState))
        } else if (lower === 'v' && !view.state.readOnly) {
          event.preventDefault(); event.stopPropagation()
          void navigator.clipboard.readText().then(pasteText)
        } else if (lower === 'z') {
          event.preventDefault(); event.stopPropagation()
          const preserveScrollTop = view.scrollDOM.scrollTop
          event.shiftKey ? redo(view) : undo(view)
          window.dispatchEvent(
            new CustomEvent('table-mutated', {
              detail: {
                ...(environment?.table ?? positions.tabular),
                preserveScrollTop,
              },
            })
          )
        } else if (lower === 'y') {
          event.preventDefault(); event.stopPropagation(); redo(view)
        }
        return
      }
      let next: TableSelection | null = null
      if (event.key === 'ArrowLeft') next = event.shiftKey ? selectionState.extend('left', model) : selectionState.moveLeft(model)
      else if (event.key === 'ArrowRight') next = event.shiftKey ? selectionState.extend('right', model) : selectionState.moveRight(model)
      else if (event.key === 'ArrowUp') next = event.shiftKey ? selectionState.extend('up', model) : selectionState.moveUp(model)
      else if (event.key === 'ArrowDown') next = event.shiftKey ? selectionState.extend('down', model) : selectionState.moveDown(model)
      else if (event.key === 'Tab') next = event.shiftKey ? selectionState.movePrevious(model) : selectionState.moveNext(model)
      else {
        const row = selectionState.to.row
        const index = model.getCellIndex(row, selectionState.to.cell)
        const source = model.rows[row].cells[index].content.trim()
        if (event.key === 'Enter') startEditing(row, index, source)
        else if (event.key.length === 1 && !event.altKey && !view.state.readOnly) {
          startEditing(row, index, source, event.key)
        }
      }
      if (next) {
        event.preventDefault(); event.stopPropagation(); setSelection(next)
      }
    }
    const onCopy = (event: ClipboardEvent) => {
      if (activeTable !== wrapper || !selectionState || editing) return
      event.preventDefault(); event.stopPropagation()
      event.clipboardData?.setData('text/plain', selectedText(selectionState))
      if (!event.clipboardData) void navigator.clipboard.writeText(selectedText(selectionState))
    }
    const onPaste = (event: ClipboardEvent) => {
      if (activeTable !== wrapper || !selectionState || editing) return
      const text = event.clipboardData?.getData('text/plain')
      if (!text || view.state.readOnly) return
      event.preventDefault(); event.stopPropagation(); pasteText(text)
    }
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (wrapper.contains(target)) {
        exitOnMouseUp.current = false
        activeTable = wrapper
      } else if (!target.closest('.table-generator-dialog-backdrop')) {
        exitOnMouseUp.current = true
      }
    }
    const onMouseUp = () => {
      const exit = exitOnMouseUp.current
      exitOnMouseUp.current = false
      window.setTimeout(() => {
        pointer.current = null
        draggingRef.current = false
        setDragging(false)
        if (exit) {
          commitEditing()
          setSelection(null)
        }
      })
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('copy', onCopy, true)
    window.addEventListener('paste', onPaste, true)
    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('mouseup', onMouseUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('copy', onCopy, true)
      window.removeEventListener('paste', onPaste, true)
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('mouseup', onMouseUp, true)
    }
  }, [commitEditing, deleteSelection, editing, environment, model, pasteText,
      positions.tabular, selectedText, selectionState, setSelection,
      startEditing, toggleSelectedCells, view, wrapperRef])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (selectionState && wrapper) activeTable = wrapper
    return () => {
      if (
        wrapper &&
        activeTable === wrapper &&
        !persistedSelections.has(wrapper) &&
        !persistedSelectionsByPosition.has(selectionKey)
      ) {
        activeTable = null
      }
    }
  }, [selectionKey, selectionState, wrapperRef])

  useEffect(() => {
    const onFormattingRequest = (event: Event) => {
      const command = (event as CustomEvent<{
        command?: '\\textbf' | '\\textit'
      }>).detail.command
      if (
        activeTable !== wrapperRef.current ||
        !selectionState ||
        editing ||
        !command
      ) return
      if (toggleSelectedCells(command)) event.preventDefault()
    }
    window.addEventListener('table-formatting-request', onFormattingRequest)
    return () =>
      window.removeEventListener('table-formatting-request', onFormattingRequest)
  }, [editing, selectionState, toggleSelectedCells, wrapperRef])

  useEffect(() => {
    if (!selectionState) return
    window.dispatchEvent(
      new CustomEvent('table-selection-changed', {
        detail: {
          text: selectedText(selectionState),
          formatting: selectedFormatting(selectionState),
        },
      })
    )
  }, [model, selectedFormatting, selectedText, selectionState])

  const selectionValue = useMemo<SelectionContextValue>(
    () => ({
      selection: selectionState,
      dragging,
      setSelection,
      selectRow,
      selectColumn,
      pointerDown,
      pointerMove,
      pointerUp,
      dispatchCommand,
    }),
    [selectionState, dragging, setSelection, selectRow, selectColumn,
      pointerDown, pointerMove, pointerUp, dispatchCommand]
  )
  const editingValue = useMemo<EditingContextValue>(
    () => ({
      editing,
      startEditing,
      updateDraft,
      commitEditing,
      cancelEditing,
    }),
    [editing, startEditing, updateDraft, commitEditing, cancelEditing]
  )
  return (
    <SelectionContext.Provider value={selectionValue}>
      <EditingContext.Provider value={editingValue}>
        {children}
      </EditingContext.Provider>
    </SelectionContext.Provider>
  )
}

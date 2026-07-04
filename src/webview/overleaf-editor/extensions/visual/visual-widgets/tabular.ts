import { redo, undo } from '@codemirror/commands'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, WidgetType } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import {
  BorderTheme,
  insertColumn,
  insertRow,
  mergeCells,
  moveCaption,
  removeCaption,
  removeColumnWidths,
  removeRowsOrColumns,
  removeTable,
  setAlignment,
  setBorders,
  setColumnWidth,
  unmergeCells,
  generateColumnSpecification,
  type TablePositions,
} from '../../../components/table-generator/table-commands'
import { TableSelection } from '../../../components/table-generator/table-selection'
import {
  generateTable,
  parseTableEnvironment,
  validateParsedTable,
  type ParsedTableData,
} from '../../../components/table-generator/utils'
import { parser } from '../../../lezer-latex/latex.mjs'
import { loadMathJax } from '../../../../mathjax/load-mathjax'
import { typesetNodeIntoElement } from '../utils/typeset-content'

export function renderTableCellContent(
  source: string,
  element: HTMLElement
): void {
  element.replaceChildren()
  const tree = parser.parse(source)
  const state = EditorState.create({ doc: source })
  let renderedNestedTable = false

  tree.iterate({
    enter(nodeRef) {
      if (renderedNestedTable) return false
      if (nodeRef.type.name !== 'TabularEnvironment') return
      try {
        const parsed = generateTable(nodeRef.node, state)
        if (!validateParsedTable(parsed)) return
        renderStaticTable(parsed, element)
        renderedNestedTable = true
        return false
      } catch {
        return
      }
    },
  })

  if (!renderedNestedTable) {
    typesetNodeIntoElement(tree.topNode, element, source.substring.bind(source))
  }
}

function renderStaticTable(
  parsedTableData: ParsedTableData,
  element: HTMLElement
): void {
  const table = document.createElement('table')
  table.className = 'latex-visual-table latex-visual-nested-table'
  for (const row of parsedTableData.table.rows) {
    const tr = table.insertRow()
    for (const cell of row.cells) {
      const td = tr.insertCell()
      td.colSpan = cell.multiColumn?.columnSpan ?? 1
      renderTableCellContent(cell.content, td)
    }
  }
  element.append(table)
}

type RenderedCell = {
  element: HTMLTableCellElement
  row: number
  cellIndex: number
  fromColumn: number
  toColumn: number
  source: string
  renderedContent: HTMLDivElement
}

type MenuItem = {
  id: string
  label?: string
  icon?: string
  active?: boolean
  disabled?: boolean
  divider?: boolean
  run?: () => void
}

const DRAG_THRESHOLD_PX = 4

const icon = (name: string): HTMLSpanElement => {
  const element = document.createElement('span')
  element.className = 'material-symbols'
  element.textContent = name
  element.setAttribute('aria-hidden', 'true')
  return element
}

export class TabularWidget extends WidgetType {
  private static cleanup = new WeakMap<HTMLElement, () => void>()
  private static activeTable: HTMLElement | null = null

  constructor(
    private parsedTableData: ParsedTableData,
    private tabularNode: SyntaxNode,
    private content: string,
    private tableNode: SyntaxNode | null,
    private isDirectChildOfTableEnvironment: boolean
  ) {
    super()
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'ol-cm-tabular table-generator'
    if (this.tableNode) wrapper.classList.add('ol-cm-environment-table')

    const model = this.parsedTableData.table
    const positions: TablePositions = {
      ...this.parsedTableData,
      tabular: { from: this.tabularNode.from, to: this.tabularNode.to },
    }
    const environment = this.tableNode
      ? parseTableEnvironment(this.tableNode)
      : undefined
    let captionArgument: SyntaxNode | null = null
    this.tableNode?.cursor().iterate(nodeRef => {
      if (!nodeRef.type.is('Caption')) return
      captionArgument = nodeRef.node.getChild('TextArgument')
      return false
    })
    const table = document.createElement('table')
    table.className = 'latex-visual-table table-generator-table'
    table.tabIndex = -1
    const toolbar = document.createElement('div')
    toolbar.className = 'table-generator-floating-toolbar'
    toolbar.hidden = true
    wrapper.append(toolbar)

    const renderedCells: RenderedCell[] = []
    let selection: TableSelection | null = null
    let dragging = false
    let pointerStart:
      | {
          x: number
          y: number
          row: number
          fromColumn: number
          toColumn: number
          cell: HTMLTableCellElement
        }
      | null = null
    let editing: HTMLTextAreaElement | null = null
    let openPopup: HTMLElement | null = null
    let exitOnMouseUp = false

    const keepVisualTableExpanded = () => {
      const range = environment?.table ?? positions.tabular
      const selection = view.state.selection.main
      if (selection.to < range.from || selection.from > range.to) return
      const position =
        range.from > 0
          ? range.from - 1
          : Math.min(view.state.doc.length, range.to + 1)
      view.dispatch({ selection: EditorSelection.cursor(position) })
    }

    const closePopup = () => {
      openPopup?.remove()
      openPopup = null
      wrapper
        .querySelectorAll('.table-generator-toolbar-button.active')
        .forEach(button => button.classList.remove('active'))
    }

    const dispatchCommand = (command: () => void) => {
      closePopup()
      command()
      window.dispatchEvent(
        new CustomEvent('table-mutated', {
          detail: {
            ...(environment?.table ?? positions.tabular),
          },
        })
      )
    }

    const button = (
      id: string,
      symbol: string,
      label: string,
      command: () => void,
      disabled = false,
      active = false
    ) => {
      const result = document.createElement('button')
      result.type = 'button'
      result.id = id
      result.className = 'table-generator-toolbar-button'
      result.title = label
      result.setAttribute('aria-label', label)
      result.setAttribute('aria-disabled', String(disabled))
      result.disabled = disabled
      result.classList.toggle('active', active)
      result.append(icon(symbol))
      result.addEventListener('mousedown', event => event.preventDefault())
      result.addEventListener('click', () => {
        if (!disabled) dispatchCommand(command)
      })
      return result
    }

    const menuButton = (
      id: string,
      label: string,
      items: MenuItem[],
      options: { icon?: string; disabled?: boolean; compact?: boolean } = {}
    ) => {
      const trigger = document.createElement('button')
      trigger.type = 'button'
      trigger.id = id
      trigger.disabled = Boolean(options.disabled)
      trigger.setAttribute('aria-disabled', String(Boolean(options.disabled)))
      trigger.setAttribute('aria-haspopup', 'menu')
      trigger.setAttribute('aria-expanded', 'false')
      trigger.title = label
      trigger.className = options.compact
        ? 'table-generator-toolbar-button'
        : 'table-generator-toolbar-dropdown-toggle'
      if (options.icon) trigger.append(icon(options.icon))
      if (!options.compact) {
        const text = document.createElement('span')
        text.textContent = label
        trigger.append(text)
      }
      const caret = document.createElement('span')
      caret.className = 'table-generator-menu-caret'
      caret.textContent = '⌄'
      trigger.append(caret)
      trigger.addEventListener('mousedown', event => event.preventDefault())
      trigger.addEventListener('click', event => {
        event.stopPropagation()
        if (options.disabled) return
        if (openPopup) {
          const sameTrigger = openPopup.dataset.trigger === id
          closePopup()
          if (sameTrigger) return
        }
        const popup = document.createElement('div')
        popup.className =
          'table-generator-toolbar-dropdown-popover table-generator-toolbar-dropdown-menu'
        popup.dataset.trigger = id
        popup.setAttribute('role', 'menu')
        for (const item of items) {
          if (item.divider) {
            popup.append(document.createElement('hr'))
            continue
          }
          const option = document.createElement('button')
          option.type = 'button'
          option.id = item.id
          option.disabled = Boolean(item.disabled)
          option.setAttribute('role', 'menuitem')
          option.setAttribute('aria-disabled', String(Boolean(item.disabled)))
          option.classList.toggle(
            'ol-cm-toolbar-dropdown-option-active',
            Boolean(item.active)
          )
          if (item.icon) option.append(icon(item.icon))
          const text = document.createElement('span')
          text.className = 'table-generator-button-label'
          text.textContent = item.label ?? ''
          option.append(text)
          option.addEventListener('mousedown', event => event.preventDefault())
          option.addEventListener('click', event => {
            event.stopPropagation()
            if (!item.disabled && item.run) dispatchCommand(item.run)
          })
          popup.append(option)
        }
        const triggerRect = trigger.getBoundingClientRect()
        const wrapperRect = wrapper.getBoundingClientRect()
        popup.style.left = `${Math.max(0, triggerRect.left - wrapperRect.left)}px`
        popup.style.top = `${triggerRect.bottom - wrapperRect.top + 4}px`
        wrapper.append(popup)
        openPopup = popup
        trigger.classList.add('active')
        trigger.setAttribute('aria-expanded', 'true')
      })
      return trigger
    }

    const group = () => {
      const element = document.createElement('div')
      element.className = 'table-generator-button-group'
      toolbar.append(element)
      return element
    }

    const showHelp = () => {
      const dialog = document.createElement('div')
      dialog.className =
        'table-generator-dialog-backdrop table-generator-help-modal'
      dialog.innerHTML = `
        <div class="table-generator-dialog" role="dialog" aria-modal="true" aria-labelledby="table-help-title">
          <h2 id="table-help-title">Table editor help</h2>
          <p>This tool lets you edit simple LaTeX tables without writing the table code directly.</p>
          <h3>How it works</h3>
          <p>Select cells by dragging, or use the row and column handles. Double-click a cell to edit it. Use the floating toolbar to change the selected cells.</p>
          <h3>Customizing tables</h3>
          <p>Complex table code may need to be edited in source mode. Fixed-width columns require the <code>array</code> package.</p>
          <div class="table-generator-dialog-actions"><button type="button">Close</button></div>
        </div>`
      const close = () => dialog.remove()
      dialog.addEventListener('mousedown', event => {
        if (event.target === dialog) close()
      })
      dialog.querySelector('button')?.addEventListener('click', close)
      wrapper.append(dialog)
    }

    const showWidthDialog = () => {
      if (!selection) return
      const dialog = document.createElement('div')
      dialog.className =
        'table-generator-dialog-backdrop table-generator-width-modal'
      const form = document.createElement('form')
      form.className = 'table-generator-dialog'
      form.innerHTML = `
        <h2>Set column width</h2>
        <div class="table-generator-width-fields">
          <label>Column width <input name="width" required /></label>
          <label><span class="visually-hidden">Length unit</span>
            <select name="unit">
              <option value="%">%</option><option value="mm">mm</option>
              <option value="cm">cm</option><option value="in">in</option>
              <option value="pt">pt</option><option value="custom">Custom</option>
            </select>
          </label>
        </div>
        <p class="table-generator-width-help">% is the percentage of the line width.</p>
        <p>Text wrapping requires <code>\\usepackage{array}</code>.</p>
        <div class="table-generator-dialog-actions">
          <button type="button" data-cancel>Cancel</button>
          <button type="submit">OK</button>
        </div>`
      const width = form.elements.namedItem('width') as HTMLInputElement
      const unit = form.elements.namedItem('unit') as HTMLSelectElement
      const singleColumn =
        selection.width() === 1 ? model.columns[selection.to.cell] : undefined
      if (singleColumn?.size) {
        unit.value = singleColumn.size.unit
        width.value = String(singleColumn.size.width)
      }
      const close = () => dialog.remove()
      form
        .querySelector<HTMLButtonElement>('[data-cancel]')
        ?.addEventListener('click', close)
      unit.addEventListener('change', () => {
        width.type = unit.value === 'custom' ? 'text' : 'number'
      })
      form.addEventListener('submit', event => {
        event.preventDefault()
        if (!selection) return close()
        const selectedUnit = unit.value as
          | '%'
          | 'mm'
          | 'cm'
          | 'in'
          | 'pt'
          | 'custom'
        setColumnWidth(
          view,
          selection,
          selectedUnit === 'custom'
            ? { unit: 'custom', width: width.value }
            : { unit: selectedUnit, width: Number(width.value) },
          positions,
          model
        )
        close()
      })
      dialog.append(form)
      wrapper.append(dialog)
      width.focus()
    }

    const renderToolbar = () => {
      toolbar.replaceChildren()
      toolbar.hidden = !selection || view.state.readOnly
      if (!selection || view.state.readOnly) return

      const captionAbove =
        Boolean(environment?.caption) &&
        environment!.caption!.from < positions.tabular.from
      const captionBelow =
        Boolean(environment?.caption) &&
        environment!.caption!.from > positions.tabular.to
      const captionLabel = captionAbove
        ? 'Caption above'
        : captionBelow
          ? 'Caption below'
          : 'No caption'
      const borderTheme = model.getBorderTheme()
      const borderLabel =
        borderTheme === BorderTheme.FULLY_BORDERED
          ? 'All borders'
          : borderTheme === BorderTheme.NO_BORDERS
            ? 'No borders'
            : borderTheme === BorderTheme.BOOKTABS
              ? 'Booktabs'
              : 'Custom borders'

      const structureGroup = group()
      structureGroup.append(
        menuButton(
          'table-generator-caption-dropdown',
          captionLabel,
          [
            {
              id: 'table-generator-caption-none',
              label: 'No caption',
              active: !environment?.caption,
              run: () => removeCaption(view, environment),
            },
            {
              id: 'table-generator-caption-above',
              label: 'Caption above',
              active: captionAbove,
              run: () => moveCaption(view, positions, 'above', environment),
            },
            {
              id: 'table-generator-caption-below',
              label: 'Caption below',
              active: captionBelow,
              run: () => moveCaption(view, positions, 'below', environment),
            },
          ],
          {
            disabled: !environment || !this.isDirectChildOfTableEnvironment,
          }
        ),
        menuButton('table-generator-borders-dropdown', borderLabel, [
          {
            id: 'table-generator-borders-fully-bordered',
            label: 'All borders',
            icon: '▦',
            active: borderTheme === BorderTheme.FULLY_BORDERED,
            run: () =>
              setBorders(view, BorderTheme.FULLY_BORDERED, positions, model),
          },
          {
            id: 'table-generator-borders-no-borders',
            label: 'No borders',
            icon: '□',
            active: borderTheme === BorderTheme.NO_BORDERS,
            run: () =>
              setBorders(view, BorderTheme.NO_BORDERS, positions, model),
          },
          {
            id: 'table-generator-borders-booktabs',
            label: 'Booktabs',
            icon: '☰',
            active: borderTheme === BorderTheme.BOOKTABS,
            run: () =>
              setBorders(view, BorderTheme.BOOKTABS, positions, model),
          },
        ])
      )

      const editGroup = group()
      const fullColumn = selection.isAnyColumnSelected(model)
      const merged = selection.isMergedCellSelected(model)
      const alignDisabled = !fullColumn && !merged
      const { minX } = selection.normalized()
      const currentAlignment = merged
        ? model.getCell(selection.from.row, selection.from.cell).multiColumn
            ?.columns.specification[0]?.alignment
        : model.columns[minX]?.alignment
      editGroup.append(
        menuButton(
          'table-generator-align-dropdown',
          'Alignment',
          [
            {
              id: 'table-generator-align-left',
              label: 'Left',
              icon: '≡',
              active: currentAlignment === 'left',
              run: () =>
                setAlignment(view, selection!, 'left', positions, model),
            },
            {
              id: 'table-generator-align-center',
              label: 'Center',
              icon: '≣',
              active: currentAlignment === 'center',
              run: () =>
                setAlignment(view, selection!, 'center', positions, model),
            },
            {
              id: 'table-generator-align-right',
              label: 'Right',
              icon: '≡',
              active: currentAlignment === 'right',
              run: () =>
                setAlignment(view, selection!, 'right', positions, model),
            },
            ...(selection.isOnlyFixedWidthColumns(model) && !merged
              ? [
                  {
                    id: 'table-generator-align-justify',
                    label: 'Justify',
                    icon: '☰',
                    active: currentAlignment === 'paragraph',
                    run: () =>
                      setAlignment(
                        view,
                        selection!,
                        'paragraph',
                        positions,
                        model
                      ),
                  },
                ]
              : []),
          ],
          { icon: '≡', disabled: alignDisabled, compact: true }
        ),
        menuButton(
          'format_text_wrap',
          'Adjust column width',
          [
            {
              id: 'table-generator-unwrap-text',
              label: 'Stretch width to text',
              active: selection.isOnlyNonFixedWidthColumns(model),
              run: () =>
                removeColumnWidths(view, selection!, positions, model),
            },
            {
              id: 'table-generator-wrap-text',
              label: selection.isOnlyFixedWidthColumns(model)
                ? 'Fixed width'
                : 'Fixed width (wrap text)',
              active: selection.isOnlyFixedWidthColumns(model),
              run: showWidthDialog,
            },
            ...(selection.isOnlyFixedWidthColumns(model)
              ? [
                  { id: '', divider: true },
                  {
                    id: 'table-generator-resize',
                    label: 'Set column width',
                    run: showWidthDialog,
                  },
                ]
              : []),
          ],
          { icon: '↔', disabled: !fullColumn, compact: true }
        ),
        button(
          'table-generator-merge-cells',
          merged ? '⊟' : '⊞',
          merged ? 'Unmerge cells' : 'Merge cells',
          () =>
            merged
              ? unmergeCells(view, selection!, model)
              : mergeCells(view, selection!, model),
          !merged && !selection.isMergeableCells(model),
          merged
        ),
        button(
          'table-generator-remove-column-row',
          '⌫',
          'Delete row or column',
          () => removeRowsOrColumns(view, selection!, positions, model),
          !selection.isAnyRowSelected(model) &&
            !selection.isAnyColumnSelected(model)
        ),
        menuButton(
          'table-generator-add-dropdown',
          'Insert',
          [
            {
              id: 'table-generator-insert-column-left',
              label: `Insert ${
                selection.maximumCellWidth(model) === 1
                  ? 'column'
                  : `${selection.maximumCellWidth(model)} columns`
              } left`,
              run: () =>
                insertColumn(view, selection!, positions, false, model),
            },
            {
              id: 'table-generator-insert-column-right',
              label: `Insert ${
                selection.maximumCellWidth(model) === 1
                  ? 'column'
                  : `${selection.maximumCellWidth(model)} columns`
              } right`,
              run: () =>
                insertColumn(view, selection!, positions, true, model),
            },
            { id: '', divider: true },
            {
              id: 'table-generator-insert-row-above',
              label: `Insert ${
                selection.height() === 1
                  ? 'row'
                  : `${selection.height()} rows`
              } above`,
              run: () => insertRow(view, selection!, positions, false, model),
            },
            {
              id: 'table-generator-insert-row-below',
              label: `Insert ${
                selection.height() === 1
                  ? 'row'
                  : `${selection.height()} rows`
              } below`,
              run: () => insertRow(view, selection!, positions, true, model),
            },
          ],
          { icon: '+', compact: true }
        )
      )

      const removeGroup = group()
      removeGroup.append(
        button('table-generator-remove-table', '✕', 'Delete table', () =>
          removeTable(view, positions, environment)
        ),
        button('table-generator-show-help', '?', 'Help', showHelp)
      )
    }

    const updateSelection = (next: TableSelection | null) => {
      selection = next?.explode(model) ?? null
      TabularWidget.activeTable = selection ? wrapper : null
      for (const cell of renderedCells) {
        const selected = Boolean(
          selection?.contains(cell.row, cell.fromColumn, model)
        )
        const bounds = selection?.normalized()
        cell.element.classList.toggle('selected', selected)
        cell.element.classList.toggle(
          'selection-edge-top',
          selected && cell.row === bounds?.minY
        )
        cell.element.classList.toggle(
          'selection-edge-bottom',
          selected && cell.row === bounds?.maxY
        )
        cell.element.classList.toggle(
          'selection-edge-left',
          selected && cell.fromColumn === bounds?.minX
        )
        cell.element.classList.toggle(
          'selection-edge-right',
          selected && cell.toColumn === bounds?.maxX
        )
      }
      table
        .querySelectorAll('.table-generator-selector-cell')
        .forEach(selector => selector.classList.remove('fully-selected'))
      if (selection) {
        model.columns.forEach((_, column) => {
          if (selection!.isColumnSelected(column, model)) {
            table
              .querySelector(`[data-column-selector="${column}"]`)
              ?.classList.add('fully-selected')
          }
        })
        model.rows.forEach((_, row) => {
          if (selection!.isRowSelected(row, model)) {
            table
              .querySelector(`[data-row-selector="${row}"]`)
              ?.classList.add('fully-selected')
          }
        })
        const target = renderedCells.find(
          cell =>
            cell.row === selection!.to.row &&
            cell.fromColumn <= selection!.to.cell &&
            cell.toColumn >= selection!.to.cell
        )
        target?.element.focus({ preventScroll: true })
        if (dragging) document.getSelection()?.removeAllRanges()
      }
      renderToolbar()
      window.dispatchEvent(
        new CustomEvent('table-selection-changed', {
          detail: { text: selection ? selectedText() : undefined },
        })
      )
    }

    const selectedText = () => {
      if (!selection) return ''
      const { minX, maxX, minY, maxY } = selection.normalized()
      const output: string[] = []
      for (let row = minY; row <= maxY; row++) {
        const values: string[] = []
        model.iterateCells(row, row, minX, maxX, cell => {
          values.push(cell.content)
        })
        output.push(values.join('\t'))
      }
      return output.join('\n')
    }

    const deleteSelectedCells = () => {
      if (!selection || view.state.readOnly) return
      const { minX, maxX, minY, maxY } = selection.normalized()
      const changes: Array<{ from: number; to: number; insert: string }> = []
      const removesWholeRows =
        minX === 0 && maxX >= model.columns.length - 1

      if (removesWholeRows) {
        if (minY === 0 && maxY >= model.rows.length - 1) {
          changes.push({
            from: positions.rowPositions[0].from,
            to: positions.rowPositions.at(-1)!.to,
            insert: '',
          })
        } else {
          for (let row = minY; row <= maxY; row++) {
            changes.push({ ...positions.rowPositions[row], insert: '' })
          }
        }
      } else {
        for (let row = 0; row < model.rows.length; row++) {
          const rowCells = renderedCells.filter(cell => cell.row === row)
          const selectedCells = rowCells.filter(
            cell => cell.toColumn >= minX && cell.fromColumn <= maxX
          )
          if (!selectedCells.length) continue
          const firstIndex = rowCells.indexOf(selectedCells[0])
          const lastIndex = rowCells.indexOf(selectedCells.at(-1)!)
          const firstPosition = positions.cellPositions[row][firstIndex]
          const lastPosition = positions.cellPositions[row][lastIndex]
          const separators = positions.cellSeparators[row]

          if (firstIndex === 0) {
            changes.push({
              from: firstPosition.from,
              to: separators[lastIndex]?.to ?? lastPosition.to,
              insert: '',
            })
          } else {
            changes.push({
              from: separators[firstIndex - 1].from,
              to: lastPosition.to,
              insert: '',
            })
          }
        }

        const columns = model.columns.filter(
          (_, column) => column < minX || column > maxX
        )
        changes.push({
          from: positions.specification.from,
          to: positions.specification.to,
          insert: generateColumnSpecification(columns),
        })
      }

      if (changes.length) {
        updateSelection(null)
        keepVisualTableExpanded()
        view.dispatch({ changes, userEvent: 'delete' })
      }
    }

    const pasteText = (text: string) => {
      if (!selection || !text || view.state.readOnly) return
      const { minX, minY } = selection.normalized()
      const changes: Array<{ from: number; to: number; insert: string }> = []
      text
        .replace(/\r/g, '')
        .split('\n')
        .forEach((rowText, rowOffset) => {
          const row = minY + rowOffset
          if (row >= model.rows.length) return
          const start = model.getCellIndex(row, minX)
          rowText.split('\t').forEach((value, cellOffset) => {
            const cell = model.rows[row].cells[start + cellOffset]
            if (cell) changes.push({ from: cell.from, to: cell.to, insert: value })
          })
        })
      if (changes.length) {
        keepVisualTableExpanded()
        view.dispatch({ changes, userEvent: 'input.paste' })
      }
    }

    const finishEditing = (commit: boolean, restoreCellFocus = true) => {
      if (!editing) return
      const input = editing
      const cell = renderedCells.find(item => item.element.contains(input))
      editing = null
      if (!cell) return
      cell.element.classList.remove('editing')
      if (
        commit &&
        !view.state.readOnly &&
        input.value !== cell.source
      ) {
        const position =
          this.parsedTableData.cellPositions[cell.row]?.[cell.cellIndex]
        if (position) {
          keepVisualTableExpanded()
          view.dispatch({
            changes: { ...position, insert: input.value },
            userEvent: 'input',
          })
          return
        }
      }
      renderTableCellContent(cell.source, cell.renderedContent)
      cell.element.replaceChildren(cell.renderedContent)
      if (restoreCellFocus) cell.element.focus()
    }

    const filterCellInput = (value: string) =>
      value
        .replace(/(^|[^\\])&/g, '$1\\&')
        .replace(/(^|[^\\])%/g, '$1\\%')
        .replaceAll('\\\\', '')

    const startEditing = (cell: RenderedCell, initial?: string) => {
      if (view.state.readOnly) return
      finishEditing(true)
      updateSelection(
        new TableSelection({ row: cell.row, cell: cell.fromColumn })
      )
      const input = document.createElement('textarea')
      editing = input
      input.className = 'table-generator-cell-input'
      input.value = initial === undefined ? cell.source : initial
      cell.element.classList.add('editing')
      cell.element.replaceChildren(input)
      const resize = () => {
        input.style.height = '1px'
        input.style.height = `${Math.max(30, input.scrollHeight)}px`
      }
      input.addEventListener('input', () => {
        const filtered = filterCellInput(input.value)
        if (filtered !== input.value) {
          const caret = input.selectionStart
          input.value = filtered
          input.setSelectionRange(caret + 1, caret + 1)
        }
        resize()
      })
      input.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault()
          finishEditing(false)
        } else if (event.key === 'Tab') {
          event.preventDefault()
          finishEditing(true)
        }
      })
      input.addEventListener('blur', () => {
        if (!exitOnMouseUp) finishEditing(true, false)
      })
      input.focus()
      if (initial === undefined) {
        input.setSelectionRange(input.value.length, input.value.length)
      }
      resize()
    }

    const thead = table.createTHead()
    if (model.columns.some(column => column.size)) {
      const widthRow = thead.insertRow()
      widthRow.className = 'table-generator-column-widths-row'
      widthRow.insertCell()
      model.columns.forEach((column, columnIndex) => {
        const td = widthRow.insertCell()
        if (!column.size) return
        const size = document.createElement('button')
        size.type = 'button'
        size.className = 'table-generator-column-indicator-button'
        size.textContent = `${column.size.width}${column.size.unit}`
        size.title = 'Set column width'
        size.addEventListener('click', () => {
          updateSelection(
            new TableSelection(
              { row: 0, cell: columnIndex },
              { row: model.rows.length - 1, cell: columnIndex }
            )
          )
          showWidthDialog()
        })
        td.append(size)
      })
    }
    const columnSelectorRow = thead.insertRow()
    columnSelectorRow.insertCell()
    model.columns.forEach((_, column) => {
      const selector = columnSelectorRow.insertCell()
      selector.className = 'table-generator-selector-cell column-selector'
      selector.dataset.columnSelector = String(column)
      selector.addEventListener('mousedown', event => {
        event.preventDefault()
        updateSelection(
          selection
            ? selection.selectColumn(column, event.shiftKey, model)
            : new TableSelection(
                { row: 0, cell: column },
                { row: model.rows.length - 1, cell: column }
              )
        )
      })
    })

    const tbody = table.createTBody()
    model.rows.forEach((row, rowIndex) => {
      const tr = tbody.insertRow()
      const rowSelector = tr.insertCell()
      rowSelector.className = 'table-generator-selector-cell row-selector'
      rowSelector.dataset.rowSelector = String(rowIndex)
      rowSelector.addEventListener('mousedown', event => {
        event.preventDefault()
        updateSelection(
          selection
            ? selection.selectRow(rowIndex, event.shiftKey, model)
            : new TableSelection(
                { row: rowIndex, cell: 0 },
                { row: rowIndex, cell: model.columns.length - 1 }
              )
        )
      })

      let logicalColumn = 0
      row.cells.forEach((cell, cellIndex) => {
        const td = tr.insertCell()
        const width = cell.multiColumn?.columnSpan ?? 1
        const fromColumn = logicalColumn
        const toColumn = logicalColumn + width - 1
        logicalColumn += width
        const column = cell.multiColumn
          ? cell.multiColumn.columns.specification[0]
          : model.columns[fromColumn]
        td.colSpan = width
        td.tabIndex = rowIndex * row.cells.length + cellIndex + 1
        td.className = `table-generator-cell alignment-${column.alignment}`
        td.classList.toggle(
          'table-generator-cell-border-left',
          column.borderLeft > 0
        )
        td.classList.toggle(
          'table-generator-cell-border-right',
          column.borderRight > 0
        )
        td.classList.toggle(
          'table-generator-row-border-top',
          row.borderTop > 0
        )
        td.classList.toggle(
          'table-generator-row-border-bottom',
          row.borderBottom > 0
        )
        const source = cell.content.trim()
        const renderedContent = document.createElement('div')
        renderedContent.className = 'table-generator-cell-render'
        renderTableCellContent(source, renderedContent)
        td.append(renderedContent)
        const renderedCell: RenderedCell = {
          element: td,
          row: rowIndex,
          cellIndex,
          fromColumn,
          toColumn,
          source,
          renderedContent,
        }
        renderedCells.push(renderedCell)

        void loadMathJax()
          .then(async MathJax => {
            if (!renderedContent.isConnected) return
            await MathJax.typesetPromise([renderedContent])
            view.requestMeasure()
            MathJax.typesetClear([renderedContent])
          })
          .catch(() => {})

        td.addEventListener('mousedown', event => {
          if (event.button !== 0 || event.target instanceof HTMLTextAreaElement) {
            return
          }
          event.preventDefault()
          document.getSelection()?.removeAllRanges()
          TabularWidget.activeTable = wrapper
          pointerStart = {
            x: event.clientX,
            y: event.clientY,
            row: rowIndex,
            fromColumn,
            toColumn,
            cell: td,
          }
        })
        td.addEventListener('mousemove', event => {
          if (!pointerStart || event.buttons !== 1) return
          if (!dragging) {
            const distance = Math.hypot(
              event.clientX - pointerStart.x,
              event.clientY - pointerStart.y
            )
            if (distance < DRAG_THRESHOLD_PX && td === pointerStart.cell) return
            dragging = true
            updateSelection(
              new TableSelection(
                { row: pointerStart.row, cell: pointerStart.fromColumn },
                { row: pointerStart.row, cell: pointerStart.toColumn }
              )
            )
          }
          event.preventDefault()
          document.getSelection()?.removeAllRanges()
          updateSelection(
            new TableSelection(selection?.from ?? {
              row: rowIndex,
              cell: fromColumn,
            }, {
              row: rowIndex,
              cell: fromColumn,
            })
          )
        })
        td.addEventListener('mouseup', event => {
          if (!pointerStart || event.button !== 0) return
          const wasDragging = dragging
          pointerStart = null
          dragging = false
          if (!wasDragging) startEditing(renderedCell)
        })
      })
    })

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        TabularWidget.activeTable !== wrapper ||
        !selection ||
        editing ||
        wrapper.querySelector('.table-generator-dialog-backdrop')
      ) {
        return
      }
      const commandKey = event.ctrlKey || event.metaKey
      const lower = event.key.toLowerCase()
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        event.stopPropagation()
        deleteSelectedCells()
        return
      }
      if (commandKey && !event.altKey) {
        if (lower === 'a') {
          event.preventDefault()
          event.stopPropagation()
          updateSelection(
            new TableSelection(
              { row: 0, cell: 0 },
              {
                row: model.rows.length - 1,
                cell: model.columns.length - 1,
              }
            )
          )
        } else if (lower === 'c') {
          event.preventDefault()
          event.stopPropagation()
          void navigator.clipboard.writeText(selectedText())
        } else if (lower === 'v' && !view.state.readOnly) {
          event.preventDefault()
          event.stopPropagation()
          void navigator.clipboard.readText().then(pasteText)
        } else if (lower === 'z') {
          event.preventDefault()
          event.stopPropagation()
          event.shiftKey ? redo(view) : undo(view)
        } else if (lower === 'y') {
          event.preventDefault()
          event.stopPropagation()
          redo(view)
        }
        return
      }

      let next: TableSelection | null = null
      if (event.key === 'ArrowLeft') {
        next = event.shiftKey
          ? selection.extend('left', model)
          : selection.moveLeft(model)
      } else if (event.key === 'ArrowRight') {
        next = event.shiftKey
          ? selection.extend('right', model)
          : selection.moveRight(model)
      } else if (event.key === 'ArrowUp') {
        next = event.shiftKey
          ? selection.extend('up', model)
          : selection.moveUp(model)
      } else if (event.key === 'ArrowDown') {
        next = event.shiftKey
          ? selection.extend('down', model)
          : selection.moveDown(model)
      } else if (event.key === 'Tab') {
        next = event.shiftKey
          ? selection.movePrevious(model)
          : selection.moveNext(model)
      } else if (event.key === 'Enter') {
        const target = renderedCells.find(
          cell =>
            cell.row === selection!.to.row &&
            cell.fromColumn <= selection!.to.cell &&
            cell.toColumn >= selection!.to.cell
        )
        if (target) startEditing(target)
      } else if (
        event.key.length === 1 &&
        !event.altKey &&
        !view.state.readOnly
      ) {
        const target = renderedCells.find(
          cell =>
            cell.row === selection!.to.row &&
            cell.fromColumn <= selection!.to.cell &&
            cell.toColumn >= selection!.to.cell
        )
        if (target) startEditing(target, event.key)
      }
      if (next) {
        event.preventDefault()
        event.stopPropagation()
        updateSelection(next)
      }
    }

    const onCopy = (event: ClipboardEvent) => {
      if (TabularWidget.activeTable !== wrapper || !selection || editing) return
      event.preventDefault()
      event.stopPropagation()
      event.clipboardData?.setData('text/plain', selectedText())
      if (!event.clipboardData) {
        void navigator.clipboard.writeText(selectedText())
      }
    }
    const onPaste = (event: ClipboardEvent) => {
      if (TabularWidget.activeTable !== wrapper || !selection || editing) return
      const text = event.clipboardData?.getData('text/plain')
      if (!text || view.state.readOnly) return
      event.preventDefault()
      event.stopPropagation()
      pasteText(text)
    }
    const onWindowMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (wrapper.contains(target)) {
        exitOnMouseUp = false
        TabularWidget.activeTable = wrapper
        view.dispatch()
      } else if (!target.closest('.table-generator-dialog-backdrop')) {
        exitOnMouseUp = true
      }
    }
    const onWindowMouseUp = () => {
      const shouldExit = exitOnMouseUp
      exitOnMouseUp = false
      window.setTimeout(() => {
        pointerStart = null
        dragging = false
        if (shouldExit) {
          finishEditing(true, false)
          updateSelection(null)
        }
      })
    }
    const onDocumentClick = (event: MouseEvent) => {
      if (
        openPopup &&
        !openPopup.contains(event.target as Node) &&
        !(event.target as HTMLElement).closest('[aria-haspopup="menu"]')
      ) {
        closePopup()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('copy', onCopy, true)
    window.addEventListener('paste', onPaste, true)
    window.addEventListener('mousedown', onWindowMouseDown, true)
    window.addEventListener('mouseup', onWindowMouseUp, true)
    document.addEventListener('click', onDocumentClick)
    TabularWidget.cleanup.set(wrapper, () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('copy', onCopy, true)
      window.removeEventListener('paste', onPaste, true)
      window.removeEventListener('mousedown', onWindowMouseDown, true)
      window.removeEventListener('mouseup', onWindowMouseUp, true)
      document.removeEventListener('click', onDocumentClick)
      if (TabularWidget.activeTable === wrapper) {
        TabularWidget.activeTable = null
        window.dispatchEvent(
          new CustomEvent('table-selection-changed', {
            detail: { text: undefined },
          })
        )
      }
    })

    const caption = captionArgument
      ? document.createElement('div')
      : null
    if (caption && captionArgument) {
      caption.className = 'table-generator-caption'
      typesetNodeIntoElement(captionArgument, caption, view.state)
      void loadMathJax()
        .then(async MathJax => {
          if (!caption.isConnected) return
          await MathJax.typesetPromise([caption])
          view.requestMeasure()
          MathJax.typesetClear([caption])
        })
        .catch(() => {})
    }

    if (
      caption &&
      environment?.caption &&
      environment.caption.from < positions.tabular.from
    ) {
      wrapper.append(caption, table)
    } else {
      wrapper.append(table)
      if (caption) wrapper.append(caption)
    }
    return wrapper
  }

  eq(widget: TabularWidget): boolean {
    return (
      this.tabularNode.from === widget.tabularNode.from &&
      this.tableNode?.from === widget.tableNode?.from &&
      this.tableNode?.to === widget.tableNode?.to &&
      this.content === widget.content &&
      this.isDirectChildOfTableEnvironment ===
        widget.isDirectChildOfTableEnvironment
    )
  }

  ignoreEvent(): boolean {
    return true
  }

  destroy(element: HTMLElement): void {
    TabularWidget.cleanup.get(element)?.()
    TabularWidget.cleanup.delete(element)
  }

  coordsAt(element: HTMLElement): DOMRect {
    return element.getBoundingClientRect()
  }

  get estimatedHeight(): number {
    return this.parsedTableData.table.rows.length * 50
  }
}

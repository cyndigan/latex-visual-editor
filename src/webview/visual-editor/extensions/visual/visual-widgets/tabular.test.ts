// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { LaTeXLanguage } from '../../../languages/latex/latex-language'
import { parser } from '../../../lezer-latex/latex.mjs'
import {
  generateTable,
  validateParsedTable,
} from '../../../components/table-generator/utils'
import { TableData } from '../../../components/table-generator/table-model'
import { TabularWidget, renderTableCellContent } from './tabular'
import { atomicDecorations } from '../atomic-decorations'
import { markDecorations } from '../mark-decorations'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('renderTableCellContent', () => {
  it('renders rich LaTeX formatting instead of raw commands', () => {
    const element = document.createElement('div')

    renderTableCellContent(
      String.raw`\textbf{Bold} and \textit{italic} with \underline{underline}`,
      element
    )

    expect(element.textContent).toBe('Bold and italic with underline')
    expect(element.querySelector('b')?.textContent).toBe('Bold')
    expect(element.querySelector('i')?.textContent).toBe('italic')
    expect(
      element.querySelector('.ol-cm-command-underline')?.textContent
    ).toBe('underline')
  })

  it('renders nested tabular content as a table', () => {
    const element = document.createElement('div')

    renderTableCellContent(
      String.raw`\begin{tabular}{l}Inner A\\Inner B\end{tabular}`,
      element
    )

    const table = element.querySelector('table')
    expect(table).not.toBeNull()
    expect(table?.querySelectorAll('tr')).toHaveLength(2)
    expect(element.textContent).toContain('Inner A')
    expect(element.textContent).toContain('Inner B')
  })
})

describe('TabularWidget', () => {
  const mounted: Array<{ widget: TabularWidget; dom: HTMLElement }> = []
  afterEach(() => {
    act(() => {
      for (const { widget, dom } of mounted.splice(0)) widget.destroy(dom)
    })
    document.body.replaceChildren()
  })

  const createWidget = (first = 'first', readOnly = false) => {
    const dispatches: unknown[] = []
    const widget = new TabularWidget(
      {
        table: new TableData(
          [
            {
              cells: [
                { content: first, from: 0, to: 5 },
                { content: 'second', from: 8, to: 14 },
              ],
              borderTop: 0,
              borderBottom: 0,
            },
          ],
          [
            {
              alignment: 'left',
              borderLeft: 0,
              borderRight: 0,
              content: 'l',
              cellSpacingLeft: '',
              cellSpacingRight: '',
              customCellDefinition: '',
              isParagraphColumn: false,
            },
            {
              alignment: 'right',
              borderLeft: 0,
              borderRight: 0,
              content: 'r',
              cellSpacingLeft: '',
              cellSpacingRight: '',
              customCellDefinition: '',
              isParagraphColumn: false,
            },
          ]
        ),
        cellPositions: [[{ from: 0, to: 5 }, { from: 8, to: 14 }]],
        cellSeparators: [[{ from: 5, to: 8 }]],
        rowPositions: [{ from: 0, to: 17, hlines: [] }],
        rowSeparators: [],
        specification: { from: 20, to: 22 },
      } as never,
      { from: 0, to: 17 } as never,
      `${first} & second`,
      null,
      false
    )
    let dom!: HTMLElement
    act(() => {
      dom = widget.toDOM({
        dispatch(spec?: unknown) {
          dispatches.push(spec)
        },
        requestMeasure() {},
        state: {
          readOnly,
          doc: { length: 22 },
          selection: { main: { anchor: 0, head: 0 } },
          sliceDoc: () => 'lr',
        },
      } as never)
      document.body.append(dom)
    })
    mounted.push({ widget, dom })
    expect(dom.classList.contains('table-generator')).toBe(true)
    return {
      widget,
      dom,
      cells: dom.querySelectorAll<HTMLTableCellElement>(
        '.table-generator-cell'
      ),
      dispatches,
    }
  }

  it('inserts a caret and keeps table options visible on a single click', () => {
    const { dom, cells } = createWidget()
    act(() => {
      cells[0].dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 10,
        })
      )
      cells[0].dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          button: 0,
          clientX: 10,
        })
      )
    })

    const input = cells[0].querySelector<HTMLElement>('.cm-content')
    expect(input).not.toBeNull()
    expect(document.activeElement).toBe(input)
    expect(input?.textContent).toBe('first')
    expect(cells[0].classList.contains('selected')).toBe(true)
    expect(
      dom.querySelector<HTMLElement>('.table-generator-floating-toolbar')
        ?.hidden
    ).toBe(false)
    expect(
      dom.querySelector('#table-generator-borders-dropdown')
    ).not.toBeNull()
  })

  it.each(['Escape', 'Tab'])(
    'restores rendered cell content after %s exits editing',
    key => {
      const { cells } = createWidget('$x^2$')
      act(() => {
        cells[0].dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, button: 0 })
        )
        cells[0].dispatchEvent(
          new MouseEvent('mouseup', { bubbles: true, button: 0 })
        )
      })
      const input = cells[0].querySelector<HTMLElement>('.cm-content')!
      expect(input.textContent).toBe('$x^2$')
      act(() => {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, key })
        )
      })
      expect(cells[0].querySelector('.cm-editor')).toBeNull()
      expect(cells[0].querySelector('.table-generator-cell-render')).not.toBeNull()
    }
  )

  it('restores rendered cell content after blur', () => {
    const { cells } = createWidget('$x^2$')
    act(() => {
      cells[0].dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0 })
      )
      cells[0].dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, button: 0 })
      )
    })
    act(() => cells[0].querySelector<HTMLElement>('.cm-content')!.blur())
    expect(cells[0].querySelector('.cm-editor')).toBeNull()
    expect(cells[0].querySelector('.table-generator-cell-render')).not.toBeNull()
  })

  it('does not enter editing in a read-only table', () => {
    const { cells } = createWidget('first', true)
    act(() => {
      cells[0].dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0 })
      )
      cells[0].dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, button: 0 })
      )
    })
    expect(cells[0].querySelector('.cm-editor')).toBeNull()
  })

  it('routes global shortcuts only to the active table', () => {
    const first = createWidget()
    const second = createWidget()
    act(() => {
      second.cells[1].dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 0,
        })
      )
      second.cells[1].dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          buttons: 1,
          clientX: 10,
        })
      )
      second.cells[1].dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, button: 0 })
      )
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    })
    expect(first.dispatches).toHaveLength(0)
    expect(second.dispatches.at(-1)).toMatchObject({ userEvent: 'delete' })
  })

  it('unmounts the React table when the widget is destroyed', () => {
    const { dom, widget } = createWidget()
    act(() => widget.destroy(dom))
    expect(dom.childElementCount).toBe(0)
  })

  it('selects cells by dragging without native text selection', async () => {
    const { cells } = createWidget()
    act(() => {
      cells[0].dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 0,
          clientY: 0,
        })
      )
      cells[1].dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          buttons: 1,
          clientX: 10,
          clientY: 0,
        })
      )
      cells[1].dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, button: 0 })
      )
    })
    expect(cells[0].classList.contains('selected')).toBe(true)
    expect(cells[1].classList.contains('selected')).toBe(true)
    expect(cells[0].classList.contains('selection-edge-left')).toBe(true)
    expect(cells[1].classList.contains('selection-edge-right')).toBe(true)
    expect(document.getSelection()?.rangeCount).toBe(0)

    document.body.tabIndex = -1
    document.body.focus()
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          ctrlKey: true,
          key: 'a',
        })
      )
    })
    expect([...cells].every(cell => cell.classList.contains('selected'))).toBe(
      true
    )

    await act(async () => {
      document.body.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0 })
      )
      document.body.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, button: 0 })
      )
      await new Promise(resolve => window.setTimeout(resolve))
    })
    expect([...cells].some(cell => cell.classList.contains('selected'))).toBe(
      false
    )
  })

  it('deletes selected cells structurally', () => {
    const { cells, dispatches } = createWidget()
    act(() => {
      cells[1].dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 0,
          clientY: 0,
        })
      )
      cells[1].dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          buttons: 1,
          clientX: 10,
          clientY: 0,
        })
      )
      cells[1].dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, button: 0 })
      )
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    })

    expect(dispatches.at(-1)).toMatchObject({
      changes: [
        { from: 5, to: 14, insert: '' },
        { from: 20, to: 22, insert: 'l' },
      ],
      userEvent: 'delete',
    })
  })

  it('deletes a column from the example document and keeps a valid table', () => {
    const source = readFileSync('examples/test-document.tex', 'utf8')
    const state = EditorState.create({ doc: source })
    let tabularNode: SyntaxNode | undefined
    parser.parse(source).iterate({
      enter(node) {
        if (node.type.name === 'TabularEnvironment' && !tabularNode) {
          tabularNode = node.node
        }
      },
    })
    const parsed = generateTable(tabularNode!, state)
    let transaction: { changes: unknown; userEvent: string } | undefined
    const widget = new TabularWidget(
      parsed,
      tabularNode!,
      source.slice(tabularNode!.from, tabularNode!.to),
      null,
      false
    )
    const dom = widget.toDOM({
      dispatch(spec: typeof transaction) {
        if (spec?.changes) transaction = spec
      },
      requestMeasure() {},
      state,
    } as never)
    document.body.append(dom)
    const secondColumnSelector = dom.querySelector<HTMLTableCellElement>(
      '[data-column-selector="1"]'
    )!

    act(() => {
      secondColumnSelector.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
        })
      )
    })
    dom
      .querySelector<HTMLButtonElement>(
        '#table-generator-remove-column-row'
      )!
      .click()

    expect(Array.isArray(transaction!.changes)).toBe(true)
    const nextState = state.update({
      changes: transaction!.changes as never,
    }).state
    const nextSource = nextState.doc.toString()
    let nextTabularNode: SyntaxNode | undefined
    parser.parse(nextSource).iterate({
      enter(node) {
        if (node.type.name === 'TabularEnvironment' && !nextTabularNode) {
          nextTabularNode = node.node
        }
      },
    })
    const nextParsed = generateTable(nextTabularNode!, nextState)

    expect(validateParsedTable(nextParsed)).toBe(true)
    expect(nextParsed.table.rows).toHaveLength(4)
    expect(nextParsed.table.columns).toHaveLength(1)
    expect(
      nextState.sliceDoc(
        nextParsed.specification.from,
        nextParsed.specification.to
      )
    ).toBe('|l|')
    expect(nextParsed.table.rows[1].cells.map(cell => cell.content.trim())).toEqual([
      'Headings',
    ])
    act(() => widget.destroy(dom))
  })

  it('moves a caption above and below through the toolbar', () => {
    const moveThroughToolbar = (
      source: string,
      target: 'above' | 'below'
    ) => {
      const state = EditorState.create({ doc: source })
      let tableNode: SyntaxNode | undefined
      let tabularNode: SyntaxNode | undefined
      parser.parse(source).iterate({
        enter(node) {
          if (node.type.name === 'TableEnvironment' && !tableNode) {
            tableNode = node.node
          }
          if (node.type.name === 'TabularEnvironment' && !tabularNode) {
            tabularNode = node.node
          }
        },
      })
      let transaction: { changes?: unknown } | undefined
      const widget = new TabularWidget(
        generateTable(tabularNode!, state),
        tabularNode!,
        source.slice(tableNode!.from, tableNode!.to),
        tableNode!,
        true
      )
      let dom!: HTMLElement
      act(() => {
        dom = widget.toDOM({
          dispatch(spec: typeof transaction) {
            if (spec?.changes) transaction = spec
          },
          requestMeasure() {},
          state,
        } as never)
        document.body.append(dom)
      })
      const cell = dom.querySelector<HTMLTableCellElement>(
        '.table-generator-cell'
      )!
      act(() => {
        cell.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, button: 0 })
        )
        cell.dispatchEvent(
          new MouseEvent('mouseup', { bubbles: true, button: 0 })
        )
      })
      act(() => {
        cell
          .querySelector<HTMLElement>('.cm-content')!
          .dispatchEvent(
            new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })
          )
        dom
          .querySelector<HTMLButtonElement>(
            '#table-generator-caption-dropdown'
          )!
          .click()
      })
      act(() => {
        dom
          .querySelector<HTMLButtonElement>(
            `#table-generator-caption-${target}`
          )!
          .click()
      })
      expect(transaction?.changes).toBeDefined()
      const next = state.update({ changes: transaction!.changes as never }).state
      act(() => widget.destroy(dom))
      return next.doc.toString()
    }

    const below = String.raw`\begin{table}
\begin{tabular}{l}
A\\
\end{tabular}
\caption{A caption}
\end{table}`
    const above = moveThroughToolbar(below, 'above')
    expect(above.indexOf('\\caption')).toBeLessThan(
      above.indexOf('\\begin{tabular}')
    )
    const movedBelow = moveThroughToolbar(above, 'below')
    expect(movedBelow.indexOf('\\caption')).toBeGreaterThan(
      movedBelow.indexOf('\\end{tabular}')
    )
  })

  it('opens the table toolbar menu popups', () => {
    const { dom, cells } = createWidget()
    act(() => {
      cells[0].dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0 })
      )
      cells[0].dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          buttons: 1,
          clientX: 10,
        })
      )
      cells[0].dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          button: 0,
          clientX: 10,
        })
      )
    })

    act(() => {
      dom
        .querySelector<HTMLButtonElement>(
          '#table-generator-borders-dropdown'
        )!
        .click()
    })
    expect(
      dom.querySelector('#table-generator-borders-fully-bordered')
    ).not.toBeNull()

    act(() => {
      dom
        .querySelector<HTMLButtonElement>('#table-generator-add-dropdown')!
        .click()
    })
    expect(
      dom.querySelector('#table-generator-insert-column-left')
    ).not.toBeNull()
    expect(dom.querySelector('#table-generator-insert-row-below')).not.toBeNull()
  })

  it('runs toolbar menu commands', () => {
    const { dom, cells, dispatches } = createWidget()
    act(() => {
      cells[0].dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0 })
      )
      cells[0].dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          buttons: 1,
          clientX: 10,
        })
      )
      cells[0].dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 10 })
      )
    })
    act(() => {
      dom
        .querySelector<HTMLButtonElement>(
          '#table-generator-borders-dropdown'
        )!
        .click()
    })
    act(() => {
      dom
        .querySelector<HTMLButtonElement>(
          '#table-generator-borders-no-borders'
        )!
        .click()
    })
    expect(dispatches.some(dispatch => dispatch && typeof dispatch === 'object'))
      .toBe(true)
  })

  it('does not show a help button in the table toolbar', () => {
    const { dom, cells } = createWidget()
    act(() => {
      cells[0].dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0 })
      )
      cells[0].dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, button: 0 })
      )
    })
    expect(dom.querySelector('#table-generator-show-help')).toBeNull()
    expect(dom.querySelector('.table-generator-help-modal')).toBeNull()
  })

  it('opens the width dialog without dispatching a document mutation', () => {
    const { dom, dispatches } = createWidget()
    act(() => {
      dom
        .querySelector<HTMLElement>('[data-column-selector="0"]')!
        .dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, button: 0 })
        )
    })
    act(() => {
      dom.querySelector<HTMLButtonElement>('#format_text_wrap')!.click()
    })
    act(() => {
      dom
        .querySelector<HTMLButtonElement>('#table-generator-wrap-text')!
        .click()
    })
    expect(dom.querySelector('.table-generator-width-modal')).not.toBeNull()
    expect(dispatches).toHaveLength(0)
  })

  it('runs the merge toolbar button when its selection is valid', () => {
    const { dom, cells, dispatches } = createWidget()
    act(() => {
      cells[0].dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 0,
        })
      )
      cells[1].dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          buttons: 1,
          clientX: 10,
        })
      )
      cells[1].dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 10 })
      )
    })
    const merge = dom.querySelector<HTMLButtonElement>(
      '#table-generator-merge-cells'
    )!
    expect(merge.disabled).toBe(false)
    act(() => merge.click())
    expect(dispatches.at(-1)).toMatchObject({
      changes: { insert: String.raw`\multicolumn{2}{c}{first second}` },
    })
  })

  it('parses tabularx with a width argument and X columns', () => {
    const source = String.raw`\begin{tabularx}{\linewidth}{@{}XXXXX@{}}
\toprule
Dataset & Year & Fault generation & Modalities & Notes\\
\midrule
CWRU & 1999 & Artificial bearing faults & Vibration & Widely cited dataset\\
\bottomrule
\end{tabularx}`
    const state = EditorState.create({ doc: source })
    let tabularNode: SyntaxNode | undefined
    parser.parse(source).iterate({
      enter(node) {
        if (node.type.name === 'TabularEnvironment' && !tabularNode) {
          tabularNode = node.node
        }
      },
    })

    const parsed = generateTable(tabularNode!, state)

    expect(validateParsedTable(parsed)).toBe(true)
    expect(parsed.table.columns).toHaveLength(5)
    expect(state.sliceDoc(parsed.specification.from, parsed.specification.to)).toBe(
      '@{}XXXXX@{}'
    )
  })

  it('parses an inserted empty column as a valid table', () => {
    const source = String.raw`\begin{tabular}{clc}
    A  && B \\
    C  && D \\
  \end{tabular}`
    const state = EditorState.create({ doc: source })
    let tabularNode: SyntaxNode | undefined
    parser.parse(source).iterate({
      enter(node) {
        if (node.type.name === 'TabularEnvironment' && !tabularNode) {
          tabularNode = node.node
        }
      },
    })

    const parsed = generateTable(tabularNode!, state)
    expect(validateParsedTable(parsed)).toBe(true)
    expect(parsed.table.columns).toHaveLength(3)
    expect(parsed.table.rows).toHaveLength(2)
  })

})

describe('visual table source boundaries', () => {
  let view: EditorView | undefined

  afterEach(() => view?.destroy())

  it('keeps captions, labels, and modifier commands visible and editable', () => {
    const source = String.raw`Intro paragraph.

\begin{table}
\centering
\resizebox{\textwidth}{!}{
\begin{tabular}{ll}
A & B\\
\end{tabular}
}
\caption{Original caption}
\label{tab:visible}
\end{table}`
    view = new EditorView({
      doc: source,
      parent: document.body,
      extensions: [
        LaTeXLanguage,
        markDecorations,
        atomicDecorations({ previewByPath: () => null }),
      ],
    })

    expect(view.dom.querySelector('.table-generator-table')).not.toBeNull()
    expect(view.dom.querySelector('.table-generator-caption')).toBeNull()
    expect(view.dom.textContent).not.toContain('\\begin{table}')
    expect(view.dom.textContent).not.toContain('\\end{table}')
    expect(view.dom.textContent).toContain('resizebox')
    expect(view.dom.textContent).toContain('Original caption')
    expect(view.dom.textContent).toContain('tab:visible')

    const captionFrom = source.indexOf('Original caption')
    view.dispatch({
      changes: {
        from: captionFrom,
        to: captionFrom + 'Original caption'.length,
        insert: 'Edited caption',
      },
    })

    expect(view.state.doc.toString()).toContain('\\caption{Edited caption}')
    expect(view.dom.textContent).toContain('Edited caption')
  })
})

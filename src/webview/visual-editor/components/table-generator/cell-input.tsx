import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { useLayoutEffect, useRef } from 'react'
import { LaTeXLanguage } from '../../languages/latex/latex-language'
import { atomicDecorations } from '../../extensions/visual/atomic-decorations'
import { markDecorations } from '../../extensions/visual/mark-decorations'
import { mousedown } from '../../extensions/visual/selection'
import { overleafKeymap } from '../../extensions/visual/visual-keymap'
import { visualHighlightStyle, visualTheme } from '../../extensions/visual/visual-theme'
import { editorTheme, themeClassHighlighter } from '../../themes/cm6'
import { withinFormattingCommand } from '../../utils/tree-operations/formatting'
import { useTableEditing } from './contexts/editing-context'

const filterInput = (value: string) =>
  value
    .replace(/(^|[^\\])&/g, '$1\\&')
    .replace(/(^|[^\\])%/g, '$1\\%')
    .replaceAll('\\\\', '')

export function CellInput() {
  const { editing, updateDraft, commitEditing, cancelEditing } =
    useTableEditing()
  const ref = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ updateDraft, commitEditing, cancelEditing })
  callbacks.current = { updateDraft, commitEditing, cancelEditing }

  useLayoutEffect(() => {
    const host = ref.current
    if (!host || !editing) return
    const editor = new EditorView({
      state: EditorState.create({
        doc: editing.content,
        extensions: [
          LaTeXLanguage,
          visualHighlightStyle,
          themeClassHighlighter,
          visualTheme,
          editorTheme(false, {
            variableName: 'var(--vscode-symbolIcon-variableForeground)',
            string: 'var(--vscode-debugTokenExpression-string)',
          }),
          atomicDecorations({ previewByPath: () => null }),
          markDecorations,
          mousedown,
          overleafKeymap,
          keymap.of([
            { key: 'Escape', run: () => { callbacks.current.cancelEditing(); return true } },
            { key: 'Tab', run: () => { callbacks.current.commitEditing(); return true } },
          ]),
          EditorView.lineWrapping,
          EditorView.domEventHandlers({
            blur: () => callbacks.current.commitEditing(false),
          }),
          EditorView.updateListener.of(update => {
            if (update.docChanged || update.selectionSet) {
              const isFormatted = withinFormattingCommand(update.state)
              window.dispatchEvent(
                new CustomEvent('table-formatting-changed', {
                  detail: {
                    bold: isFormatted('\\textbf'),
                    italic: isFormatted('\\textit'),
                  },
                })
              )
            }
            if (!update.docChanged) return
            const content = filterInput(update.state.doc.toString())
            if (content !== update.state.doc.toString()) {
              update.view.dispatch({ changes: { from: 0, to: update.state.doc.length, insert: content } })
            } else {
              callbacks.current.updateDraft(content)
            }
          }),
        ],
      }),
      parent: host,
    })
    editor.focus()
    editor.dispatch({ selection: { anchor: editing.content.length } })
    return () => editor.destroy()
  }, [])

  if (!editing) return null
  return <div ref={ref} className="table-generator-cell-input" />
}

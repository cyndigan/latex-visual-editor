import { forceParsing, syntaxTree } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'

/**
 * Keeps standalone content visible and completes the initial syntax parse.
 */
export const showContentWhenParsed: Extension = [
  EditorView.editorAttributes.of({ class: 'ol-cm-parsed' }),
  ViewPlugin.define(view => {
    const parseTimer = window.setTimeout(() => {
      if (syntaxTree(view.state).length < view.state.doc.length) {
        forceParsing(view, view.state.doc.length, 1000)
      }
    })

    return {
      destroy() {
        window.clearTimeout(parseTimer)
      },
    }
  }),
]

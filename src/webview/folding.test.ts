// @vitest-environment jsdom
import {
  codeFolding,
  foldedRanges,
} from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createFoldingRangeFromSelection,
  documentFoldRanges,
  foldAllCode,
  foldAllComments,
  foldAllExceptSelected,
  foldLevel,
  foldRecursively,
  removeManualFoldingRanges,
  toggleFoldCode,
  toggleFoldRecursively,
  unfoldAllCode,
  unfoldAllComments,
  unfoldAllExceptSelected,
} from './folding'
import { LaTeXLanguage } from './overleaf-editor/languages/latex/latex-language'

const source = String.raw`\documentclass{article}
\begin{document}
% {
Region content.
% }
\section{First}
First section.
\subsection{Nested}
Nested content.
\begin{itemize}
\item One
\item Two
\end{itemize}
\section{Second}
Second section.
\end{document}`

describe('visual-editor folding commands', () => {
  let view: EditorView

  beforeEach(() => {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: source,
        extensions: [LaTeXLanguage, codeFolding()],
      }),
    })
  })

  afterEach(() => {
    view.destroy()
    document.body.replaceChildren()
  })

  it('finds section, environment, and marker folds from document lines', () => {
    const foldedSources = documentFoldRanges(view.state).map(range =>
      view.state.sliceDoc(range.from, range.to)
    )

    expect(foldedSources.some(text => text.includes('First section.'))).toBe(true)
    expect(foldedSources.some(text => text.includes(String.raw`\item One`))).toBe(
      true
    )
    expect(foldedSources.some(text => text.includes('Region content.'))).toBe(
      true
    )
  })

  it('supports toggle, recursive, level, and all folding commands', () => {
    selectAt(String.raw`\section{First}`)
    expect(toggleFoldCode(view)).toBe(true)
    expect(foldCount()).toBe(1)
    expect(toggleFoldCode(view)).toBe(true)
    expect(foldCount()).toBe(0)

    selectAt('Nested content.')
    expect(toggleFoldCode(view)).toBe(true)
    expect(foldCount()).toBe(1)
    expect(toggleFoldCode(view)).toBe(true)
    expect(foldCount()).toBe(0)

    selectAt(String.raw`\section{First}`)
    expect(foldRecursively(view)).toBe(true)
    expect(foldCount()).toBeGreaterThan(1)
    expect(toggleFoldRecursively(view)).toBe(true)
    expect(foldCount()).toBe(0)

    expect(foldLevel(view, 1)).toBe(true)
    expect(foldCount()).toBeGreaterThan(0)
    expect(unfoldAllCode(view)).toBe(true)
    expect(foldCount()).toBe(0)

    expect(foldAllCode(view)).toBe(true)
    expect(foldCount()).toBe(documentFoldRanges(view.state).length)
    expect(unfoldAllCode(view)).toBe(true)
    expect(foldCount()).toBe(0)
  })

  it('supports comments, except-selected, and manual folding commands', () => {
    expect(foldAllComments(view)).toBe(true)
    expect(foldCount()).toBe(1)
    expect(unfoldAllComments(view)).toBe(true)
    expect(foldCount()).toBe(0)

    selectAt('First section.')
    expect(foldAllExceptSelected(view)).toBe(true)
    expect(foldCount()).toBeGreaterThan(0)
    expect(unfoldAllExceptSelected(view)).toBe(true)
    expect(foldCount()).toBe(0)

    const from = source.indexOf('First section.')
    const to = source.indexOf('Nested content.') + 'Nested content.'.length
    view.dispatch({ selection: EditorSelection.range(from, to) })
    expect(createFoldingRangeFromSelection(view)).toBe(true)
    expect(foldCount()).toBe(1)
    expect(removeManualFoldingRanges(view)).toBe(true)
    expect(foldCount()).toBe(0)
  })

  function selectAt(text: string): void {
    view.dispatch({
      selection: EditorSelection.cursor(source.indexOf(text)),
    })
  }

  function foldCount(): number {
    let count = 0
    foldedRanges(view.state).between(0, view.state.doc.length, () => {
      count += 1
    })
    return count
  }
})

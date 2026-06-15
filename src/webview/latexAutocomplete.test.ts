import { CompletionContext } from '@codemirror/autocomplete'
import {
  EditorSelection,
  EditorState,
  TransactionSpec,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceMetadata } from '../shared/messages'
import { createLatexCompletionSource } from './latexAutocomplete'

const metadata: WorkspaceMetadata = {
  labels: ['sec:intro'],
  citationKeys: ['smith2026'],
  includes: ['chapters/intro.tex'],
  graphics: ['figures/chart.png'],
  packages: ['amsmath'],
  commands: ['vect'],
  environments: ['example'],
}

describe('LaTeX autocomplete', () => {
  it('offers Overleaf command snippets', async () => {
    const state = EditorState.create({ doc: String.raw`\sec` })
    const source = createLatexCompletionSource(() => metadata)
    const result = await source(
      new CompletionContext(state, state.doc.length, false)
    )

    expect(result && 'options' in result ? result.options.map(x => x.label) : [])
      .toContain(String.raw`\section{}`)
  })

  it('offers workspace citation keys inside cite arguments', async () => {
    const state = EditorState.create({ doc: String.raw`\cite{sm` })
    const source = createLatexCompletionSource(() => metadata)
    const result = await source(
      new CompletionContext(state, state.doc.length, false)
    )

    expect(result && 'options' in result ? result.options.map(x => x.label) : [])
      .toContain('smith2026')
  })

  it('completes an environment name with the full matching environment', async () => {
    const state = EditorState.create({ doc: String.raw`\begin{equ}` })
    const source = createLatexCompletionSource(() => metadata)
    const result = await source(new CompletionContext(state, 10, false))
    const options = result && 'options' in result ? result.options : []
    const equation = options.find(
      option => option.label === String.raw`\begin{equation} ...`
    )

    expect(result && 'from' in result ? result.from : -1).toBe(0)
    expect(equation).toBeDefined()

    let transaction: TransactionSpec | undefined
    const view = {
      state,
      dispatch: vi.fn((spec: TransactionSpec) => {
        transaction = spec
      }),
    } as unknown as EditorView
    expect(typeof equation?.apply).toBe('function')
    if (typeof equation?.apply === 'function') {
      equation.apply(view, equation, 0, 10)
    }

    expect(transaction?.changes).toEqual({
      from: 0,
      to: 11,
      insert: String.raw`\begin{equation}` + '\n\t\n' + String.raw`\end{equation}`,
    })
    const selection = transaction?.selection as EditorSelection | undefined
    expect(selection?.main.anchor).toBe(18)
    expect(selection?.main.head).toBe(18)
  })
})

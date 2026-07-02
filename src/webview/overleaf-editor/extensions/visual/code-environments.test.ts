// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { LaTeXLanguage } from '../../languages/latex/latex-language'
import { atomicDecorations } from './atomic-decorations'
import { markDecorations } from './mark-decorations'

describe('visual code environments', () => {
  let view: EditorView | undefined

  afterEach(() => view?.destroy())

  for (const environment of ['lstlisting', 'verbatim', 'minted']) {
    it(`renders ${environment} as a code block`, () => {
      const argument = environment === 'minted' ? '{python}' : ''
      const source = String.raw`before
\begin{${environment}}${argument}
print("Hello")
\end{${environment}}
after`

      view = new EditorView({
        doc: source,
        parent: document.body,
        extensions: [
          LaTeXLanguage,
          markDecorations,
          atomicDecorations({ previewByPath: () => null }),
        ],
      })

      const lines = view.dom.querySelectorAll(
        `.ol-cm-environment-${environment}.ol-cm-environment-line`
      )
      expect(lines.length).toBeGreaterThanOrEqual(3)
      expect(
        view.dom.querySelector(
          `.ol-cm-environment-${environment}.ol-cm-environment-top`
        )
      ).not.toBeNull()
      expect(
        view.dom.querySelector(
          `.ol-cm-environment-${environment}.ol-cm-environment-bottom`
        )
      ).not.toBeNull()
    })
  }
})

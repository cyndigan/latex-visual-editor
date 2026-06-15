// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { loadMathJax } from './load-mathjax'

describe('loadMathJax', () => {
  beforeEach(() => {
    window.__latexVisualEditorMathJaxPath = '/dist/mathjax/tex-svg.js'
    window.__latexVisualEditorNonce = 'test-nonce'
  })

  it('configures the Overleaf MathJax runtime before loading it', () => {
    void loadMathJax()

    expect(window.MathJax).toMatchObject({
      tex: {
        processEnvironments: true,
        macros: { bm: [String.raw`\boldsymbol{#1}`, 1] },
      },
      output: { displayOverflow: 'linebreak' },
      startup: { typeset: false },
    })
    expect(document.querySelector('script')?.src).toContain(
      '/dist/mathjax/tex-svg.js'
    )
    expect(document.querySelector('script')?.nonce).toBe('test-nonce')
  })
})

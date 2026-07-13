// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('visual editor webview', () => {
  let initializedText = ''

  beforeEach(() => {
    document.body.className = 'vscode-dark'
    document.body.style.setProperty('--vscode-editor-background', '#1e1e1e')
    document.body.innerHTML = '<div id="toolbar"></div><div id="editor"></div>'
    initializedText = String.raw`\documentclass{article}
\begin{document}
\section{Hello}
Text with \textbf{bold} and \(x^2\).
\begin{itemize}
\item One
\item Two
\end{itemize}
\end{document}`
    const postMessage = vi.fn((message: { type: string }) => {
      if (message.type !== 'ready') return
      window.postMessage(
        {
          type: 'initialize',
          text: initializedText,
          version: 1,
          documentUri: 'file:///smoke.tex',
          selection: {
            anchor: initializedText.indexOf('Text with'),
            head: initializedText.indexOf('Text with'),
          },
          metadata: {
            labels: ['sec:intro'],
            citationKeys: ['smith2026'],
            includes: [],
            graphics: [],
            packages: [],
            commands: [],
            environments: [],
          },
          configuration: {
            assetsDirectory: 'assets',
            maxImagePreviewBytes: 1024,
            syntaxValidation: true,
            useOverleafKeybindings: true,
          },
          syntaxColors: {
            variableName: '#DCDCAA',
            attributeValue: '#9CDCFE',
            comment: '#6A9955',
          },
        },
        '*'
      )
    })
    Object.assign(globalThis, {
      acquireVsCodeApi: () => ({
        postMessage,
        getState: () => undefined,
        setState: () => undefined,
      }),
      ResizeObserver: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    })
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList
    Range.prototype.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      }) as DOMRect
  })

  it('loads the Overleaf visual decorations and toolbar', async () => {
    await import('./editor')
    await new Promise(resolve => setTimeout(resolve, 25))

    expect(document.querySelector('.cm-editor')).not.toBeNull()
    expect(document.querySelector('.cm-editor.ol-cm-parsed')).not.toBeNull()
    expect(document.querySelector('.cm-content')?.textContent).toContain('Hello')
    expect(document.querySelector('.ol-cm-heading')).not.toBeNull()
    expect([...document.styleSheets].some(sheet =>
      [...sheet.cssRules].some(rule =>
        rule.cssText.includes('.tok-variableName') &&
        rule.cssText.includes('rgb(220, 220, 170)')
      )
    )).toBe(true)
    expect(document.querySelector('.cm-foldGutter')).not.toBeNull()
    expect(document.querySelector('#toolbar')?.textContent).toContain('Image')

    const editor = EditorView.findFromDOM(
      document.querySelector('.cm-editor') as HTMLElement
    )!
    expect(getComputedStyle(editor.dom).backgroundColor).toBe(
      'var(--vscode-editor-background)'
    )
    document.body.style.setProperty('--vscode-editor-background', '#ffffff')
    document.body.style.setProperty('--vscode-editor-foreground', '#111111')
    document.body.className = 'vscode-light'
    await vi.waitFor(() => {
      expect(getComputedStyle(editor.dom).color).toBe(
        'var(--vscode-editor-foreground)'
      )
    })
    expect(
      document.body.style.getPropertyValue('--vscode-editor-background')
    ).toBe('#ffffff')

    document.body.style.setProperty('--vscode-editor-background', '#1e1e1e')
    document.body.style.setProperty('--vscode-editor-foreground', '#eeeeee')
    document.body.className = 'vscode-dark'
    await vi.waitFor(() => {
      expect(getComputedStyle(editor.dom).color).toBe(
        'var(--vscode-editor-foreground)'
      )
    })
    expect(
      document.body.style.getPropertyValue('--vscode-editor-background')
    ).toBe('#1e1e1e')

    expect(
      document.querySelector('.latex-visual-current-line-number')?.textContent
    ).toBe('4')

    editor.dispatch({
      selection: EditorSelection.cursor(initializedText.indexOf('bold') + 1),
    })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(
      document.querySelector('.latex-visual-current-line-number')?.textContent
    ).toBe('4')
    expect(
      document.querySelector('[data-control="bold"]')?.getAttribute('aria-pressed')
    ).toBe('true')

    editor.dispatch({
      selection: EditorSelection.cursor(initializedText.indexOf('Hello') + 1),
    })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(
      document.querySelector('.latex-visual-current-line-number')?.textContent
    ).toBe('3')
    expect(
      (document.querySelector('[data-control="heading"]') as HTMLSelectElement)
        .value
    ).toBe('section')

    const boldFrom = initializedText.indexOf('Text with')
    editor.dispatch({
      selection: EditorSelection.range(boldFrom, boldFrom + 'Text'.length),
    })
    editor.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'b',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    )
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(editor.state.doc.toString()).toContain(String.raw`\textbf{Text} with`)

    editor.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    )
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(editor.state.doc.toString()).toBe(initializedText)

    window.postMessage(
      {
        type: 'overleafKeybindingsChanged',
        enabled: false,
      },
      '*'
    )
    await new Promise(resolve => setTimeout(resolve, 10))
    editor.dispatch({
      selection: EditorSelection.range(boldFrom, boldFrom + 'Text'.length),
    })
    editor.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'b',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    )
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(editor.state.doc.toString()).toBe(initializedText)

    const typingPosition = initializedText.indexOf('Text with') + 4
    editor.dispatch({
      changes: { from: typingPosition, insert: 'a' },
      selection: EditorSelection.cursor(typingPosition + 1),
    })
    editor.dispatch({
      changes: { from: typingPosition + 1, insert: 'b' },
      selection: EditorSelection.cursor(typingPosition + 2),
    })
    const afterRapidTyping = editor.state.doc.toString()
    window.postMessage(
      {
        type: 'documentChanged',
        text:
          initializedText.slice(0, typingPosition) +
          'a' +
          initializedText.slice(typingPosition),
        version: 2,
      },
      '*'
    )
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(editor.state.doc.toString()).toBe(afterRapidTyping)
    expect(editor.state.selection.main.head).toBe(typingPosition + 2)

    const changedText = initializedText.replace(
      'Text with',
      'Externally edited text with'
    )
    window.postMessage(
      {
        type: 'documentChanged',
        text: changedText,
        version: 10,
      },
      '*'
    )
    await new Promise(resolve => setTimeout(resolve, 25))

    expect(document.querySelector('.cm-content')?.textContent).toContain(
      'Externally edited text with'
    )
    expect(
      document.querySelector('.ol-cm-preamble-expanded')
    ).toBeNull()
  }, 15_000)
})

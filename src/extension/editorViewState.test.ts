import { describe, expect, it, vi } from 'vitest'
import {
  captureTextEditorViewState,
  getStoredViewState,
  restoreTextEditorViewState,
  storeViewState,
} from './editorViewState'

vi.mock('vscode', () => ({
  Position: class Position {
    constructor(
      public line: number,
      public character: number
    ) {}
  },
  Range: class Range {
    constructor(
      public start: unknown,
      public end: unknown
    ) {}
  },
  TextEditorRevealType: { AtTop: 1, InCenter: 2 },
}))

describe('editor view state', () => {
  it('persists positions by document URI', async () => {
    const values = new Map<string, unknown>()
    const context = {
      workspaceState: {
        get: (key: string) => values.get(key),
        update: (key: string, value: unknown) => {
          values.set(key, value)
          return Promise.resolve()
        },
      },
    } as any
    const uri = { toString: () => 'file:///document.tex' } as any

    await storeViewState(context, uri, {
      anchor: 42,
      visualScrollTop: 120,
      source: 'visual',
    })

    expect(getStoredViewState(context, uri)).toEqual({
      anchor: 42,
      visualScrollTop: 120,
      source: 'visual',
    })
  })

  it('captures and restores the visible center anchor', () => {
    const revealRange = vi.fn()
    const editor = {
      visibleRanges: [{ start: { line: 3 }, end: { line: 7 } }],
      selection: { active: { line: 2 } },
      document: {
        lineCount: 11,
        offsetAt: ({ line }: { line: number }) => line * 10,
        positionAt: (offset: number) => ({ line: offset / 10, character: 0 }),
      },
      revealRange,
    } as any

    expect(captureTextEditorViewState(editor)).toEqual({
      anchor: 50,
      source: 'source',
    })
    restoreTextEditorViewState(editor, {
      anchor: 50,
      source: 'source',
    })
    expect(revealRange).toHaveBeenCalledWith(expect.anything(), 2)
  })
})

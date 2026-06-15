import { describe, expect, it, vi } from 'vitest'

vi.mock('vscode', () => {
  class Position {
    constructor(
      public readonly line: number,
      public readonly character: number
    ) {}
  }
  class Selection {
    constructor(
      public readonly anchor: Position,
      public readonly active: Position
    ) {}
  }
  class Range {
    constructor(
      public readonly start: Position,
      public readonly end: Position
    ) {}
  }
  return {
    Position,
    Selection,
    Range,
    TextEditorRevealType: { InCenterIfOutsideViewport: 1 },
  }
})

import * as vscode from 'vscode'
import {
  captureTextEditorSelection,
  restoreTextEditorSelection,
} from './editorSelections'

describe('editor selections', () => {
  it('captures anchor and active offsets', () => {
    const editor = {
      document: {
        offsetAt: (position: vscode.Position) => position.character,
      },
      selection: {
        anchor: new vscode.Position(0, 4),
        active: new vscode.Position(0, 9),
      },
    } as vscode.TextEditor

    expect(captureTextEditorSelection(editor)).toEqual({
      anchor: 4,
      head: 9,
    })
  })

  it('restores and reveals the active offset', () => {
    const revealRange = vi.fn()
    const editor = {
      document: {
        positionAt: (offset: number) => new vscode.Position(0, offset),
      },
      selection: undefined,
      revealRange,
    } as unknown as vscode.TextEditor

    restoreTextEditorSelection(editor, { anchor: 7, head: 3 })

    expect(editor.selection.anchor.character).toBe(7)
    expect(editor.selection.active.character).toBe(3)
    expect(revealRange).toHaveBeenCalled()
  })
})

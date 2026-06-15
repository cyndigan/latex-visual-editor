import * as vscode from 'vscode'

export type EditorSelectionOffsets = {
  anchor: number
  head: number
}

const selections = new Map<string, EditorSelectionOffsets>()

/**
 * Stores a document selection as stable character offsets.
 */
export function storeEditorSelection(
  uri: vscode.Uri,
  selection: EditorSelectionOffsets
): void {
  selections.set(uri.toString(), selection)
}

/**
 * Returns the most recently observed selection for a document.
 */
export function getStoredEditorSelection(
  uri: vscode.Uri
): EditorSelectionOffsets | undefined {
  return selections.get(uri.toString())
}

/**
 * Captures a VS Code text editor selection as document offsets.
 */
export function captureTextEditorSelection(
  editor: vscode.TextEditor
): EditorSelectionOffsets {
  return {
    anchor: editor.document.offsetAt(editor.selection.anchor),
    head: editor.document.offsetAt(editor.selection.active),
  }
}

/**
 * Restores and reveals a character-offset selection in a text editor.
 */
export function restoreTextEditorSelection(
  editor: vscode.TextEditor,
  selection: EditorSelectionOffsets
): void {
  const anchor = editor.document.positionAt(selection.anchor)
  const active = editor.document.positionAt(selection.head)
  editor.selection = new vscode.Selection(anchor, active)
  editor.revealRange(
    new vscode.Range(active, active),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport
  )
}

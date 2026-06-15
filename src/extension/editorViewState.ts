import * as vscode from 'vscode'

const VIEW_STATE_KEY_PREFIX = 'latexVisualEditor.viewState.'

export type EditorViewState = {
  anchor: number
  visualScrollTop?: number
  source: 'source' | 'visual'
}

export function getStoredViewState(
  context: vscode.ExtensionContext,
  uri: vscode.Uri
): EditorViewState | undefined {
  return context.workspaceState.get<EditorViewState>(
    VIEW_STATE_KEY_PREFIX + uri.toString()
  )
}

export function storeViewState(
  context: vscode.ExtensionContext,
  uri: vscode.Uri,
  state: EditorViewState
): Thenable<void> {
  return context.workspaceState.update(VIEW_STATE_KEY_PREFIX + uri.toString(), {
    anchor: Math.max(0, state.anchor),
    visualScrollTop: state.visualScrollTop,
    source: state.source,
  })
}

/**
 * VS Code exposes visible document ranges rather than pixel scroll offsets.
 * Store source line at viewport center. Visual layout may collapse source
 * lines, so document offset is invariant and rendered line count is ignored.
 */
export function captureTextEditorViewState(
  editor: vscode.TextEditor
): EditorViewState {
  const visible = editor.visibleRanges[0]
  const line = visible
    ? Math.round((visible.start.line + visible.end.line) / 2)
    : editor.selection.active.line
  return {
    anchor: editor.document.offsetAt(new vscode.Position(line, 0)),
    source: 'source',
  }
}

export function restoreTextEditorViewState(
  editor: vscode.TextEditor,
  state: EditorViewState
): void {
  const target = editor.document.positionAt(state.anchor)
  editor.revealRange(
    new vscode.Range(target, target),
    vscode.TextEditorRevealType.InCenter
  )
}

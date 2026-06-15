import * as vscode from 'vscode'

let activePanel: vscode.WebviewPanel | undefined

/**
 * Records the currently visible visual-editor panel.
 */
export function setActiveVisualEditor(panel: vscode.WebviewPanel | undefined): void {
  activePanel = panel
  void vscode.commands.executeCommand(
    'setContext',
    'latexVisualEditor.active',
    Boolean(panel)
  )
}

/**
 * Returns the currently visible visual-editor panel.
 */
export function getActiveVisualEditor(): vscode.WebviewPanel | undefined {
  return activePanel
}

import * as vscode from 'vscode'
import {
  getActiveVisualEditor,
  getActiveVisualEditorDocument,
} from './extension/activeVisualEditor'
import { replaceDocumentEditor } from './extension/editorTabs'
import {
  captureTextEditorSelection,
  getStoredEditorSelection,
  restoreTextEditorSelection,
  storeEditorSelection,
} from './extension/editorSelections'
import {
  captureTextEditorViewState,
  getStoredViewState,
  restoreTextEditorViewState,
  storeViewState,
} from './extension/editorViewState'
import {
  buildWithLatexWorkshop,
  installReverseSyncTeXHandler,
  syncTeXWithLatexWorkshop,
} from './extension/latexWorkshop'
import {
  LatexVisualEditorProvider,
  VISUAL_EDITOR_VIEW_TYPE,
} from './extension/latexVisualEditorProvider'

const PREVIOUS_EDITOR_MODE_KEY = 'latexVisualEditor.previousEditorMode'
type TexFileOpenMode = 'Previous editor' | 'Source editor' | 'Visual editor'

/**
 * Activates commands and the custom text editor.
 */
export function activate(context: vscode.ExtensionContext): void {
  const visualEditorProvider = new LatexVisualEditorProvider(context)
  context.subscriptions.push(
    LatexVisualEditorProvider.register(context, visualEditorProvider)
  )
  void syncTexEditorAssociation(context)
  void installReverseSyncTeXHandler(async (record, data) => {
    const uri = vscode.Uri.file(record.input)
    const visualPanel = visualEditorProvider.getPanel(uri)
    if (!visualPanel) return false

    const document = await vscode.workspace.openTextDocument(uri)
    const [line, character] = locateReverseSyncPosition(
      document,
      record.line - 1,
      record.column,
      data.textBeforeSelection,
      data.textAfterSelection
    )
    const position = new vscode.Position(line, character)
    return visualEditorProvider.revealSelection(uri, {
      anchor: document.offsetAt(position),
      head: document.offsetAt(position),
    })
  }).then(disposable => context.subscriptions.push(disposable))

  const refreshWebviews = () => {
    const count = visualEditorProvider.refreshWebviews()
    void vscode.window.showInformationMessage(
      `Refreshed ${count} LaTeX visual editor webview${count === 1 ? '' : 's'}.`
    )
  }

  const openVisual = async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri
    if (!target) return
    const sourceEditor = vscode.window.activeTextEditor
    if (sourceEditor?.document.uri.toString() === target.toString()) {
      storeEditorSelection(target, captureTextEditorSelection(sourceEditor))
      await storeViewState(
        context,
        target,
        captureTextEditorViewState(sourceEditor)
      )
    }
    await recordEditorMode(context, 'visual')
    visualEditorProvider.markSourceEditorSwitch(target)
    await replaceDocumentEditor(target, VISUAL_EDITOR_VIEW_TYPE)
  }

  const openSource = async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri
    if (!target) return
    await visualEditorProvider.syncActiveEditorState(target)
    const selection = getStoredEditorSelection(target)
    const viewState = getStoredViewState(context, target)
    await recordEditorMode(context, 'source')
    await replaceDocumentEditor(target, 'default')
    const sourceEditor = vscode.window.activeTextEditor
    if (
      selection &&
      sourceEditor?.document.uri.toString() === target.toString()
    ) {
      restoreTextEditorSelection(sourceEditor, selection)
    }
    if (
      viewState !== undefined &&
      sourceEditor?.document.uri.toString() === target.toString()
    ) {
      restoreTextEditorViewState(sourceEditor, viewState)
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('latexVisualEditor.openVisual', openVisual),
    vscode.commands.registerCommand('latexVisualEditor.openSource', openSource),
    vscode.commands.registerCommand('latexVisualEditor.toggle', async (uri?: vscode.Uri) => {
      if (getActiveVisualEditor()) {
        await openSource(uri)
      } else {
        await openVisual(uri)
      }
    }),
    vscode.commands.registerCommand('latexVisualEditor.insertFigure', () => {
      void getActiveVisualEditor()?.webview.postMessage({
        type: 'command',
        command: 'insertFigure',
      })
    }),
    vscode.commands.registerCommand('latexVisualEditor.insertTable', () => {
      void getActiveVisualEditor()?.webview.postMessage({
        type: 'command',
        command: 'insertTable',
      })
    }),
    ...([
      'fold',
      'unfold',
      'toggleFold',
      'foldRecursively',
      'unfoldRecursively',
      'toggleFoldRecursively',
      'foldAll',
      'unfoldAll',
      'foldAllBlockComments',
      'foldAllMarkerRegions',
      'unfoldAllMarkerRegions',
      'foldAllExcept',
      'unfoldAllExcept',
      'foldLevel1',
      'foldLevel2',
      'foldLevel3',
      'foldLevel4',
      'foldLevel5',
      'foldLevel6',
      'foldLevel7',
      'createFoldingRangeFromSelection',
      'removeManualFoldingRanges',
    ] as const).map(command =>
      vscode.commands.registerCommand(`latexVisualEditor.${command}`, () => {
        void getActiveVisualEditor()?.webview.postMessage({
          type: 'command',
          command,
        })
      })
    ),
    vscode.commands.registerCommand(
      'latexVisualEditor.refreshWebviews',
      refreshWebviews
    ),
    vscode.commands.registerCommand(
      'latexVisualEditor.workshopBuild',
      async () => {
        const document = getActiveVisualEditorDocument()
        if (!document) return
        await visualEditorProvider.syncActiveEditorState(document.uri)
        await buildWithLatexWorkshop(document)
      }
    ),
    vscode.commands.registerCommand(
      'latexVisualEditor.workshopSyncTeX',
      async () => {
        const document = getActiveVisualEditorDocument()
        if (!document) return
        await visualEditorProvider.syncActiveEditorState(document.uri)
        const selection = getStoredEditorSelection(document.uri)
        const position = document.positionAt(selection?.head ?? 0)
        await syncTeXWithLatexWorkshop(document, position)
      }
    ),
    vscode.commands.registerCommand('latexVisualEditor.viewPdf', async () => {
      const document = getActiveVisualEditorDocument()
      if (!document) return

      const target = document.uri
      const key = target.toString()
      await visualEditorProvider.syncActiveEditorState(target)
      try {
        await replaceDocumentEditor(target, 'default')
        await vscode.commands.executeCommand('latex-workshop.view')
      } finally {
        visualEditorProvider.markSourceEditorSwitch(target)
        await replaceDocumentEditor(target, VISUAL_EDITOR_VIEW_TYPE)
      }
    }),
    vscode.window.registerUriHandler({
      handleUri(uri) {
        if (uri.path === '/refreshWebviews') {
          refreshWebviews()
        }
      },
    }),
    vscode.commands.registerCommand('latexVisualEditor.copy', async () => {
      const tableSelection = visualEditorProvider.getActiveTableSelectionText()
      if (tableSelection !== undefined) {
        await vscode.env.clipboard.writeText(tableSelection)
        return
      }
      const document = getActiveVisualEditorDocument()
      if (!document) return

      const selection = getStoredEditorSelection(document.uri)
      if (!selection) return
      const from = Math.min(selection.anchor, selection.head)
      const to = Math.max(selection.anchor, selection.head)
      await vscode.env.clipboard.writeText(
        document.getText().slice(from, to)
      )
    }),
    vscode.commands.registerCommand('latexVisualEditor.consumeShortcut', () => {})
  )

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('latexVisualEditor.openTexFilesIn')) {
        return
      }
      void syncTexEditorAssociation(context)
    })
  )
}

function locateReverseSyncPosition(
  document: vscode.TextDocument,
  requestedLine: number,
  requestedColumn: number,
  before: string,
  after: string
): [number, number] {
  const line = Math.min(Math.max(0, requestedLine), document.lineCount - 1)
  if (requestedColumn > 0) return [line, requestedColumn]

  for (const candidate of [line, line - 1, line + 1]) {
    if (candidate < 0 || candidate >= document.lineCount) continue
    const text = document.lineAt(candidate).text
    const beforeText = before.slice(-Math.min(20, before.length))
    const afterText = after.slice(0, Math.min(20, after.length))
    if (beforeText) {
      const index = text.indexOf(beforeText)
      if (index >= 0) return [candidate, index + beforeText.length]
    }
    if (afterText) {
      const index = text.indexOf(afterText)
      if (index >= 0) return [candidate, index]
    }
  }
  return [line, 0]
}

/**
 * Records the current editor mode and applies the configured editor preference
 * to the workspace association before future LaTeX files are opened.
 */
async function recordEditorMode(
  context: vscode.ExtensionContext,
  mode: 'source' | 'visual'
): Promise<void> {
  await context.workspaceState.update(PREVIOUS_EDITOR_MODE_KEY, mode)
  await syncTexEditorAssociation(context)
}

/** Updates the workspace-level association without changing unrelated editors. */
async function syncTexEditorAssociation(
  context: vscode.ExtensionContext
): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) return

  const preference = vscode.workspace
    .getConfiguration('latexVisualEditor')
    .get<TexFileOpenMode>('openTexFilesIn', 'Previous editor')
  const previousMode = context.workspaceState.get<'source' | 'visual'>(
    PREVIOUS_EDITOR_MODE_KEY,
    'visual'
  )
  const mode =
    preference === 'Previous editor'
      ? previousMode
      : preference === 'Source editor'
        ? 'source'
        : 'visual'
  const configuration = vscode.workspace.getConfiguration('workbench')
  const inspected = configuration.inspect<Record<string, string>>(
    'editorAssociations'
  )
  const associations = { ...(inspected?.workspaceValue ?? {}) }
  const editorId = mode === 'visual' ? VISUAL_EDITOR_VIEW_TYPE : 'default'
  if (associations['*.tex'] === editorId) return

  associations['*.tex'] = editorId

  try {
    await configuration.update(
      'editorAssociations',
      associations,
      vscode.ConfigurationTarget.Workspace
    )
  } catch (error) {
    console.error('Failed to update LaTeX editor association', error)
    void vscode.window.showWarningMessage(
      'LaTeX Visual Editor could not save the editor mode to this workspace.'
    )
  }
}

/**
 * Performs no explicit shutdown work.
 */
export function deactivate(): void {}

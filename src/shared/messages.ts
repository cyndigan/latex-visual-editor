export type WorkspaceMetadata = {
  labels: string[]
  citationKeys: string[]
  includes: string[]
  graphics: string[]
  packages: string[]
  commands: string[]
  environments: string[]
}

export type EditorConfiguration = {
  assetsDirectory: string
  maxImagePreviewBytes: number
  syntaxValidation: boolean
  useOverleafKeybindings: boolean
}

export type HostToWebviewMessage =
  | {
      type: 'initialize'
      text: string
      version: number
      documentUri: string
      metadata: WorkspaceMetadata
      configuration: EditorConfiguration
      selection?: { anchor: number; head: number }
      viewState?: {
        anchor: number
        visualScrollTop?: number
        source: 'source' | 'visual'
      }
    }
  | { type: 'documentChanged'; text: string; version: number }
  | { type: 'metadataChanged'; metadata: WorkspaceMetadata }
  | { type: 'overleafKeybindingsChanged'; enabled: boolean }
  | {
      type: 'command'
      command:
        | 'insertFigure'
        | 'insertTable'
        | 'fold'
        | 'unfold'
        | 'toggleFold'
        | 'foldRecursively'
        | 'unfoldRecursively'
        | 'toggleFoldRecursively'
        | 'foldAll'
        | 'unfoldAll'
        | 'foldAllBlockComments'
        | 'foldAllMarkerRegions'
        | 'unfoldAllMarkerRegions'
        | 'foldAllExcept'
        | 'unfoldAllExcept'
        | 'foldLevel1'
        | 'foldLevel2'
        | 'foldLevel3'
        | 'foldLevel4'
        | 'foldLevel5'
        | 'foldLevel6'
        | 'foldLevel7'
        | 'createFoldingRangeFromSelection'
        | 'removeManualFoldingRanges'
        | 'syncState'
        | 'revealSelection'
      requestId?: string
      selection?: { anchor: number; head: number }
    }
  | {
      type: 'resourceResolved'
      requestId: string
      path: string
      url?: string
      extension?: string
      text?: string
      error?: string
    }
  | {
      type: 'imageInserted'
      requestId: string
      path?: string
      error?: string
    }

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'focusChanged'; focused: boolean }
  | { type: 'selectionChanged'; anchor: number; head: number }
  | {
      type: 'viewStateChanged'
      anchor: number
      visualScrollTop: number
      source: 'visual'
    }
  | {
      type: 'stateSnapshot'
      requestId: string
      selection: { anchor: number; head: number }
      viewState: {
        anchor: number
        visualScrollTop: number
        source: 'visual'
      }
    }
  | {
      type: 'edit'
      version: number
      from: number
      to: number
      insert: string
    }
  | { type: 'resolveResource'; requestId: string; path: string }
  | {
      type: 'insertImage'
      requestId: string
      name: string
      mimeType: string
      bytes: number[]
    }
  | { type: 'showError'; message: string }

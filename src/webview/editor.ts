import './editor.css'

import { autocompletion } from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import {
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
} from '@codemirror/view'
import {
  foldCode,
  foldGutter,
  foldKeymap,
  syntaxTree,
  unfoldCode,
} from '@codemirror/language'
import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
  WorkspaceMetadata,
} from '../shared/messages'
import { findMinimalTextChange } from '../shared/textChange'
import type { PreviewPath } from './adapters/previewPath'
import { LaTeXLanguage } from './visual-editor/languages/latex/latex-language'
import {
  editFigureData,
  figureModal,
} from './visual-editor/extensions/figure-modal'
import { toggleRanges } from './visual-editor/commands/ranges'
import {
  toggleListForRanges,
} from './visual-editor/extensions/toolbar/lists'
import { setSectionHeadingLevel } from './visual-editor/extensions/toolbar/sections'
import {
  atomicDecorations,
  refreshAtomicDecorations,
} from './visual-editor/extensions/visual/atomic-decorations'
import { highlightCurrentLineNumber } from './visual-editor/extensions/visual/current-line-number'
import { listItemMarker } from './visual-editor/extensions/visual/list-item-marker'
import { markDecorations } from './visual-editor/extensions/visual/mark-decorations'
import { visualLineNumbers } from './visual-editor/extensions/visual/line-numbers'
import { pasteHtml } from './visual-editor/extensions/visual/paste-html'
import { mousedown } from './visual-editor/extensions/visual/selection'
import { tableGeneratorTheme } from './visual-editor/extensions/visual/table-generator'
import {
  visualHighlightStyle,
  visualTheme,
} from './visual-editor/extensions/visual/visual-theme'
import {
  overleafKeymap,
  visualKeymap,
} from './visual-editor/extensions/visual/visual-keymap'
import { showContentWhenParsed } from './showContentWhenParsed'
import { latexAutocomplete } from './latexAutocomplete'
import { findCurrentSectionHeadingLevel } from './visual-editor/extensions/toolbar/sections'
import { ancestorListType } from './visual-editor/extensions/toolbar/lists'
import { withinFormattingCommand } from './visual-editor/utils/tree-operations/formatting'
import { bracketMatching } from './visual-editor/extensions/bracket-matching'
import { mathPreview } from './visual-editor/extensions/math-preview'
import { autoPair } from './visual-editor/extensions/auto-pair'
import {
  editorTheme,
  themeClassHighlighter,
} from './visual-editor/themes/cm6'
import {
  createFoldingRangeFromSelection,
  foldAllCode,
  foldAllComments,
  foldAllExceptSelected,
  foldLevel,
  foldRecursively,
  removeManualFoldingRanges,
  toggleFoldCode,
  toggleFoldRecursively,
  unfoldAllCode,
  unfoldAllComments,
  unfoldAllExceptSelected,
  unfoldRecursively,
} from './folding'

type VsCodeApi = {
  postMessage: (message: WebviewToHostMessage) => void
  getState: () => unknown
  setState: (state: unknown) => void
}

declare const acquireVsCodeApi: () => VsCodeApi

const vscode = acquireVsCodeApi()
const resourceCache = new Map<string, PreviewPath | null>()
const pendingResources = new Map<string, string>()
const pendingImages = new Map<string, (path: string) => void>()

let view: EditorView | undefined
const selectedTheme = new Compartment()
const overleafKeybindings = new Compartment()
let hostVersion = 0
let applyingHostDocument = false
let viewStateFrame: number | undefined
let restoringViewState = false
let lastMeasuredViewState:
  | Extract<WebviewToHostMessage, { type: 'viewStateChanged' }>
  | undefined
let metadata: WorkspaceMetadata = {
  labels: [],
  citationKeys: [],
  includes: [],
  graphics: [],
  packages: [],
  commands: [],
  environments: [],
}
let useOverleafKeybindings = true
let syntaxColors: Record<string, string> = {}
// Match LaTeX Workshop's reverse-SyncTeX editor decoration lifetime.
const reverseSyncHighlightDuration = 500
const setReverseSyncHighlight = StateEffect.define<{
  from: number
  to: number
}>()
const clearReverseSyncHighlight = StateEffect.define<void>()
const reverseSyncHighlight = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let decorations = value.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (effect.is(setReverseSyncHighlight)) {
        decorations = Decoration.set([
          Decoration.mark({
            class: 'cm-reverse-synctex-highlight',
          }).range(effect.value.from, effect.value.to),
        ])
      } else if (effect.is(clearReverseSyncHighlight)) {
        decorations = Decoration.none
      }
    }
    return decorations
  },
  provide: field => EditorView.decorations.from(field),
})
let reverseSyncHighlightTimeout: number | undefined
let lastTableMutationRange: { from: number; to: number } | undefined
let tableFormattingState: { bold: boolean; italic: boolean } | undefined

window.addEventListener('focus', () => {
  vscode.postMessage({ type: 'focusChanged', focused: true })
})
window.addEventListener('blur', () => {
  vscode.postMessage({ type: 'focusChanged', focused: false })
})
vscode.postMessage({ type: 'focusChanged', focused: document.hasFocus() })
window.addEventListener('table-selection-changed', event => {
  const detail = (event as CustomEvent<{
    text?: string
    formatting?: { bold: boolean; italic: boolean }
  }>).detail
  if (detail.formatting) {
    tableFormattingState = detail.formatting
    setToolbarToggle('bold', detail.formatting.bold)
    setToolbarToggle('italic', detail.formatting.italic)
  } else {
    tableFormattingState = undefined
  }
  vscode.postMessage({
    type: 'tableSelectionChanged',
    text: detail.text,
  })
})
window.addEventListener('table-formatting-changed', event => {
  const formatting = (event as CustomEvent<{
    bold: boolean
    italic: boolean
  }>).detail
  tableFormattingState = formatting
  setToolbarToggle('bold', formatting.bold)
  setToolbarToggle('italic', formatting.italic)
})
window.addEventListener('table-mutated', event => {
  const {
    preserveScrollTop,
    ...range
  } = (
    event as CustomEvent<{
      from: number
      to: number
      preserveScrollTop?: number
    }>
  ).detail
  lastTableMutationRange = range
  if (view) {
    const selection = view.state.selection.main
    const intersects =
      range.from <= selection.to && range.to >= selection.from
    if (intersects) {
      const position =
        range.from > 0
          ? range.from - 1
          : Math.min(view.state.doc.length, range.to + 1)
      view.dispatch({ selection: EditorSelection.cursor(position) })
    }
  }
  refreshVisualDecorationsWhenParsed()
  if (preserveScrollTop !== undefined) {
    preserveVisualScrollTop(preserveScrollTop)
  }
})

window.addEventListener('message', event => {
  const message = event.data as HostToWebviewMessage
  switch (message.type) {
    case 'initialize':
      hostVersion = message.version
      metadata = message.metadata
      useOverleafKeybindings = message.configuration.useOverleafKeybindings
      syntaxColors = message.syntaxColors ?? {}
      if (!view) {
        createEditor(
          message.text,
          message.selection,
          message.viewState,
          message.focusEditor
        )
      } else {
        replaceDocumentFromHost(message.text)
      }
      break
    case 'documentChanged':
      // Local edits update CodeMirror immediately and increment hostVersion
      // optimistically. Ignore acknowledgements for earlier queued edits so
      // they cannot temporarily roll back newer input and move the cursor.
      if (message.version < hostVersion) break
      hostVersion = message.version
      if (view?.state.doc.toString() !== message.text) {
        replaceDocumentFromHost(message.text)
      }
      break
    case 'metadataChanged':
      metadata = message.metadata
      break
    case 'overleafKeybindingsChanged':
      useOverleafKeybindings = message.enabled
      if (view) {
        view.dispatch({
          effects: overleafKeybindings.reconfigure(
            useOverleafKeybindings ? overleafKeymap : []
          ),
        })
      }
      break
    case 'syntaxColorsChanged':
      syntaxColors = message.syntaxColors
      applySelectedTheme()
      break
    case 'resourceResolved': {
      const resourcePath = pendingResources.get(message.requestId)
      if (!resourcePath) break
      pendingResources.delete(message.requestId)
      resourceCache.set(
        resourcePath,
        message.url && message.extension
          ? { url: message.url, extension: message.extension }
          : null
      )
      refreshVisualDecorations()
      break
    }
    case 'imageInserted': {
      const resolve = pendingImages.get(message.requestId)
      if (!resolve) break
      pendingImages.delete(message.requestId)
      if (message.path) resolve(message.path)
      else vscode.postMessage({
        type: 'showError',
        message: message.error ?? 'Could not insert image.',
      })
      break
    }
    case 'command':
      if (message.command === 'insertFigure') openImagePicker()
      else if (message.command === 'insertTable') insertTable(3, 3)
      else if (view && runFoldingCommand(message.command, view)) break
      else if (message.command === 'syncState' && view && message.requestId) {
        vscode.postMessage({
          type: 'stateSnapshot',
          requestId: message.requestId,
          selection: {
            anchor: view.state.selection.main.anchor,
            head: view.state.selection.main.head,
          },
          viewState: measureViewState(view),
        })
      } else if (
        message.command === 'revealSelection' &&
        message.selection &&
        view
      ) {
        revealReverseSyncSelection(message.selection)
      }
      break
  }
})

function runFoldingCommand(command: string, editor: EditorView): boolean {
  const directCommands: Record<string, (view: EditorView) => boolean> = {
    fold: foldCode,
    unfold: unfoldCode,
    toggleFold: toggleFoldCode,
    foldRecursively,
    unfoldRecursively,
    toggleFoldRecursively,
    foldAll: foldAllCode,
    unfoldAll: unfoldAllCode,
    foldAllBlockComments: foldAllComments,
    foldAllMarkerRegions: foldAllComments,
    unfoldAllMarkerRegions: unfoldAllComments,
    foldAllExcept: foldAllExceptSelected,
    unfoldAllExcept: unfoldAllExceptSelected,
    createFoldingRangeFromSelection,
    removeManualFoldingRanges,
  }
  const direct = directCommands[command]
  if (direct) {
    direct(editor)
    return true
  }

  const level = /^foldLevel([1-7])$/.exec(command)?.[1]
  if (!level) return false
  foldLevel(editor, Number(level))
  return true
}

/**
 * Creates the CodeMirror editor with Overleaf's parser and visual extensions.
 */
function createEditor(
  text: string,
  selection?: { anchor: number; head: number },
  viewState?: {
    anchor: number
    visualScrollTop?: number
    source: 'source' | 'visual'
  },
  focusEditor = false
): void {
  const documentLength = text.length
  const anchor = Math.min(selection?.anchor ?? 0, documentLength)
  const head = Math.min(selection?.head ?? anchor, documentLength)
  const state = EditorState.create({
    doc: text,
    selection: EditorSelection.single(anchor, head),
    extensions: [
      LaTeXLanguage,
      EditorState.phrases.of(phrases),
      history({ newGroupDelay: 250 }),
      EditorView.lineWrapping,
      visualLineNumbers,
      foldGutter({ openText: '▾', closedText: '▸' }),
      highlightCurrentLineNumber,
      reverseSyncHighlight,
      EditorView.contentAttributes.of({ 'aria-label': 'Visual Editor editing' }),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      search(),
      autocompletion({
        icons: false,
        optionClass: completion =>
          `latex-completion-${completion.type ?? 'text'}`,
      }),
      latexAutocomplete(() => metadata),
      autoPair,
      bracketMatching(),
      mathPreview,
      visualHighlightStyle,
      themeClassHighlighter,
      visualTheme,
      selectedTheme.of(editorTheme(isDarkTheme(), syntaxColors)),
      tableGeneratorTheme,
      mousedown,
      listItemMarker,
      atomicDecorations({ previewByPath }),
      markDecorations,
      visualKeymap,
      overleafKeybindings.of(
        useOverleafKeybindings ? overleafKeymap : []
      ),
      pasteHtml,
      figureModal(),
      showContentWhenParsed,
      EditorView.updateListener.of(update => {
        if (update.docChanged && !applyingHostDocument) {
          sendMinimalEdit(update.startState.doc.toString(), update.state.doc.toString())
        }
        if (
          update.docChanged &&
          lastTableMutationRange &&
          update.transactions.some(
            transaction =>
              transaction.isUserEvent('undo') ||
              transaction.isUserEvent('redo')
          )
        ) {
          const preserveScrollTop = update.view.scrollDOM.scrollTop
          requestAnimationFrame(() => {
            window.dispatchEvent(
              new CustomEvent('table-mutated', {
                detail: { ...lastTableMutationRange, preserveScrollTop },
              })
            )
          })
        }
        if (update.selectionSet) {
          sendSelection(update.state.selection.main)
        }
        if (update.viewportChanged || update.geometryChanged) {
          scheduleViewState()
        }
        updateToolbarState()
      }),
    ],
  })

  view = new EditorView({
    state,
    parent: document.querySelector('#editor') as HTMLElement,
  })
  observeColorTheme()
  createToolbar()
  updateToolbarState()
  installImageDrop()
  window.addEventListener('figure-modal:open-modal', editSelectedFigure)
  sendSelection(view.state.selection.main)
  if (viewState) {
    restoringViewState = true
    requestAnimationFrame(() => {
      if (viewState.source === 'visual') {
        document.querySelector('#editor')?.classList.add('restoring-view')
        restoreVisualReopen(viewState.anchor, viewState.visualScrollTop)
      } else {
        centerVisualAnchor(viewState.anchor, () => {
          restoringViewState = false
          sendViewState()
        })
      }
    })
  }
  if (focusEditor) view.focus()
}

function revealReverseSyncSelection(selection: {
  anchor: number
  head: number
}): void {
  if (!view) return
  const documentLength = view.state.doc.length
  const anchor = Math.min(Math.max(0, selection.anchor), documentLength)
  const head = Math.min(Math.max(0, selection.head), documentLength)
  const line = view.state.doc.lineAt(head)
  view.dispatch({
    selection: EditorSelection.single(anchor, head),
    effects: [
      EditorView.scrollIntoView(head, { y: 'center' }),
      setReverseSyncHighlight.of({
        from: line.from,
        to: Math.max(line.from, line.to),
      }),
    ],
  })
  view.focus()
  if (reverseSyncHighlightTimeout !== undefined) {
    window.clearTimeout(reverseSyncHighlightTimeout)
  }
  reverseSyncHighlightTimeout = window.setTimeout(() => {
    view?.dispatch({ effects: clearReverseSyncHighlight.of(undefined) })
    reverseSyncHighlightTimeout = undefined
  }, reverseSyncHighlightDuration)
}

function restoreVisualReopen(anchor: number, scrollTop?: number): void {
  waitForStableLayout(() => {
    if (view && scrollTop !== undefined) {
      view.scrollDOM.scrollTop = Math.min(
        scrollTop,
        maximumScrollTop(view)
      )
    }
    centerVisualAnchor(anchor, () => requestAnimationFrame(() => {
      restoringViewState = false
      document.querySelector('#editor')?.classList.remove('restoring-view')
      sendViewState()
    }))
  })
}

function waitForStableLayout(done: () => void): void {
  let previousHeight = -1
  let stableFrames = 0
  let frames = 0
  const check = () => {
    if (!view) {
      done()
      return
    }
    const height = view.scrollDOM.scrollHeight
    stableFrames = height === previousHeight ? stableFrames + 1 : 0
    previousHeight = height
    frames += 1
    const parsed = syntaxTree(view.state).length >= view.state.doc.length
    const imagesLoaded = [...view.dom.querySelectorAll('img')].every(
      image => image.complete
    )
    if (
      (parsed && pendingResources.size === 0 && imagesLoaded && stableFrames >= 6) ||
      frames >= 300
    ) {
      done()
    } else {
      requestAnimationFrame(check)
    }
  }
  requestAnimationFrame(check)
}

/**
 * Reports top visible document position after scrolling settles.
 */
function scheduleViewState(): void {
  if (restoringViewState) return
  if (viewStateFrame !== undefined) cancelAnimationFrame(viewStateFrame)
  viewStateFrame = requestAnimationFrame(sendViewState)
}

function sendViewState(): void {
  if (viewStateFrame !== undefined) cancelAnimationFrame(viewStateFrame)
  viewStateFrame = undefined
  if (!view || restoringViewState) return
  lastMeasuredViewState = { type: 'viewStateChanged', ...measureViewState(view) }
  vscode.postMessage(lastMeasuredViewState)
}

function measureViewState(editor: EditorView): {
  anchor: number
  visualScrollTop: number
  source: 'visual'
} {
  const bounds = editor.scrollDOM.getBoundingClientRect()
  const contentBounds = editor.contentDOM.getBoundingClientRect()
  return {
    anchor:
      editor.posAtCoords({
        x: Math.min(contentBounds.left + 4, bounds.right - 1),
        y: bounds.top + bounds.height / 2,
      }) ?? editor.viewport.from,
    visualScrollTop: editor.scrollDOM.scrollTop,
    source: 'visual',
  }
}

function centerVisualAnchor(anchor: number, done?: () => void): void {
  if (!view) {
    done?.()
    return
  }
  const position = Math.min(Math.max(0, anchor), view.state.doc.length)
  const editor = view
  editor.dispatch({
    effects: EditorView.scrollIntoView(position, { y: 'center' }),
  })
  editor.requestMeasure({
    read: currentView => currentView.coordsAtPos(position),
    write: coords => {
      if (coords) {
        const bounds = editor.scrollDOM.getBoundingClientRect()
        const currentY = (coords.top + coords.bottom) / 2
        const targetY = bounds.top + bounds.height / 2
        editor.scrollDOM.scrollTop += currentY - targetY
      }
      done?.()
    },
  })
}

function maximumScrollTop(editor: EditorView): number {
  return Math.max(0, editor.scrollDOM.scrollHeight - editor.scrollDOM.clientHeight)
}

function preserveVisualScrollTop(scrollTop: number): void {
  let previousHeight = -1
  let stableFrames = 0
  let frames = 0
  const restore = () => {
    if (!view) return
    view.scrollDOM.scrollTop = Math.min(scrollTop, maximumScrollTop(view))
    const height = view.scrollDOM.scrollHeight
    stableFrames = height === previousHeight ? stableFrames + 1 : 0
    previousHeight = height
    frames += 1
    if (stableFrames < 6 && frames < 60) requestAnimationFrame(restore)
  }
  restore()
}

window.addEventListener('pagehide', () => {
  if (lastMeasuredViewState) vscode.postMessage(lastMeasuredViewState)
})

/**
 * Reports whether VS Code currently uses a dark or high-contrast dark theme.
 */
function isDarkTheme(): boolean {
  return (
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast')
  )
}

/**
 * Reconfigures CodeMirror's dark-mode class when the VS Code theme kind changes.
 */
function observeColorTheme(): void {
  let dark = isDarkTheme()
  const observer = new MutationObserver(() => {
    const nextDark = isDarkTheme()
    if (nextDark === dark) return
    dark = nextDark
    applySelectedTheme()
  })
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  })
}

/**
 * Reports the active CodeMirror selection as document offsets.
 */
function sendSelection(selection: { anchor: number; head: number }): void {
  vscode.postMessage({
    type: 'selectionChanged',
    anchor: selection.anchor,
    head: selection.head,
  })
}

/**
 * Applies the smallest host document change without echoing it back.
 */
function replaceDocumentFromHost(text: string): void {
  if (!view) return
  const currentText = view.state.doc.toString()
  if (currentText === text) return

  const change = findMinimalTextChange(currentText, text)
  applyingHostDocument = true
  try {
    view.dispatch({ changes: change })
  } finally {
    applyingHostDocument = false
  }
}

/**
 * Sends one minimal replacement covering the changed source range.
 */
function sendMinimalEdit(before: string, after: string): void {
  const change = findMinimalTextChange(before, after)

  vscode.postMessage({
    type: 'edit',
    version: hostVersion,
    ...change,
  })
  hostVersion += 1
}

/**
 * Resolves graphics paths lazily through the extension host.
 */
function previewByPath(path: string): PreviewPath | null {
  if (resourceCache.has(path)) return resourceCache.get(path) ?? null
  if (![...pendingResources.values()].includes(path)) {
    const requestId = requestIdFor('resource')
    pendingResources.set(requestId, path)
    vscode.postMessage({ type: 'resolveResource', requestId, path })
  }
  return null
}

/**
 * Forces Overleaf's selection-sensitive decoration field to rebuild.
 */
function refreshVisualDecorations(): void {
  if (!view) return
  view.dispatch({
    effects: refreshAtomicDecorations.of(),
  })
}

function applySelectedTheme(): void {
  if (!view) return
  view.dispatch({
    effects: selectedTheme.reconfigure(editorTheme(isDarkTheme(), syntaxColors)),
  })
}

function refreshVisualDecorationsWhenParsed(attempt = 0): void {
  if (!view) return
  if (syntaxTree(view.state).length < view.state.doc.length && attempt < 60) {
    requestAnimationFrame(() =>
      refreshVisualDecorationsWhenParsed(attempt + 1)
    )
    return
  }
  refreshVisualDecorations()
}

/**
 * Builds the visual formatting toolbar.
 */
function createToolbar(): void {
  const toolbar = document.querySelector('#toolbar') as HTMLElement
  toolbar.replaceChildren()

  const heading = document.createElement('select')
  heading.setAttribute('aria-label', 'Heading level')
  for (const [label, value] of [
    ['Text', 'text'],
    ['Part', 'part'],
    ['Chapter', 'chapter'],
    ['Section', 'section'],
    ['Subsection', 'subsection'],
    ['Subsubsection', 'subsubsection'],
  ]) {
    const option = document.createElement('option')
    option.textContent = label
    option.value = value
    heading.append(option)
  }
  heading.addEventListener('change', () => {
    if (view) setSectionHeadingLevel(view, heading.value)
  })
  heading.dataset.control = 'heading'
  toolbar.append(heading)

  addButton(
    toolbar,
    'Bold',
    'B',
    () => runFormatting('\\textbf'),
    'bold',
    true
  )
  addButton(
    toolbar,
    'Italic',
    'I',
    () => runFormatting('\\textit'),
    'italic',
    true
  )
  addButton(
    toolbar,
    'Quote',
    '“”',
    () => run(toggleRanges('\\say')),
    'quote',
    true
  )
  addButton(
    toolbar,
    'Bullet list',
    '•',
    () =>
      run(editor => {
        toggleListForRanges('itemize')(editor)
        return true
      }),
    'bullet-list',
    true
  )
  addButton(
    toolbar,
    'Numbered list',
    '1.',
    () =>
      run(editor => {
        toggleListForRanges('enumerate')(editor)
        return true
      }),
    'numbered-list',
    true
  )
  addButton(toolbar, 'Figure', 'Image', openImagePicker)
  addTableInserter(toolbar)
}

/**
 * Adds Overleaf's 10x10 table-size picker to the toolbar.
 */
function addTableInserter(parent: HTMLElement): void {
  const container = document.createElement('div')
  container.className = 'toolbar-table-inserter'
  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.id = 'toolbar-table'
  trigger.title = 'Table'
  trigger.setAttribute('aria-label', 'Table')
  trigger.setAttribute('aria-haspopup', 'grid')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.textContent = 'Table'

  const popup = document.createElement('div')
  popup.id = 'toolbar-table-menu'
  popup.className = 'toolbar-table-grid-popover'
  popup.hidden = true
  const sizeLabel = document.createElement('div')
  sizeLabel.className = 'toolbar-table-size-label'
  sizeLabel.textContent = 'Insert table'
  const grid = document.createElement('div')
  grid.className = 'toolbar-table-grid'
  grid.setAttribute('role', 'grid')
  grid.setAttribute('aria-label', 'Select table size')
  const cells: HTMLButtonElement[] = []

  const highlight = (columns: number, rows: number) => {
    sizeLabel.textContent = `Insert ${rows}\u00d7${columns} table`
    for (const cell of cells) {
      cell.classList.toggle(
        'active',
        Number(cell.dataset.columns) <= columns &&
          Number(cell.dataset.rows) <= rows
      )
    }
  }

  const clearHighlight = () => {
    sizeLabel.textContent = 'Insert table'
    cells.forEach(cell => cell.classList.remove('active'))
  }

  const close = () => {
    popup.hidden = true
    trigger.classList.remove('active')
    trigger.setAttribute('aria-expanded', 'false')
    clearHighlight()
  }

  for (let row = 1; row <= 10; row++) {
    for (let column = 1; column <= 10; column++) {
      const cell = document.createElement('button')
      cell.type = 'button'
      cell.className = 'toolbar-table-grid-cell'
      cell.dataset.columns = String(column)
      cell.dataset.rows = String(row)
      cell.setAttribute('role', 'gridcell')
      cell.setAttribute('aria-label', `${row} by ${column} table`)
      cell.addEventListener('mouseenter', () => highlight(column, row))
      cell.addEventListener('focus', () => highlight(column, row))
      cell.addEventListener('mousedown', event => event.preventDefault())
      cell.addEventListener('click', () => {
        close()
        insertTable(column, row)
      })
      cells.push(cell)
      grid.append(cell)
    }
  }
  grid.addEventListener('mouseleave', clearHighlight)
  grid.addEventListener('keydown', event => {
    const current = event.target as HTMLButtonElement
    const index = cells.indexOf(current)
    if (index < 0) return
    let next = index
    if (event.key === 'ArrowLeft') next = Math.max(0, index - 1)
    else if (event.key === 'ArrowRight') {
      next = Math.min(cells.length - 1, index + 1)
    } else if (event.key === 'ArrowUp') next = Math.max(0, index - 10)
    else if (event.key === 'ArrowDown') {
      next = Math.min(cells.length - 1, index + 10)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
      trigger.focus()
      return
    } else {
      return
    }
    event.preventDefault()
    cells[next].focus()
  })

  trigger.addEventListener('mousedown', event => event.preventDefault())
  trigger.addEventListener('click', event => {
    event.stopPropagation()
    popup.hidden = !popup.hidden
    trigger.classList.toggle('active', !popup.hidden)
    trigger.setAttribute('aria-expanded', String(!popup.hidden))
  })
  popup.addEventListener('click', event => event.stopPropagation())
  window.addEventListener('mousedown', event => {
    if (!container.contains(event.target as Node)) close()
  })

  popup.append(sizeLabel, grid)
  container.append(trigger, popup)
  parent.append(container)
}

/**
 * Adds one accessible toolbar button.
 */
function addButton(
  parent: HTMLElement,
  label: string,
  text: string,
  action: () => void,
  control?: string,
  toggle = false
): void {
  const button = document.createElement('button')
  button.type = 'button'
  button.title = label
  button.setAttribute('aria-label', label)
  button.textContent = text
  if (control) button.dataset.control = control
  if (toggle) button.setAttribute('aria-pressed', 'false')
  button.addEventListener('mousedown', event => event.preventDefault())
  button.addEventListener('click', action)
  parent.append(button)
}

/**
 * Runs a CodeMirror command and restores editor focus.
 */
function runFormatting(command: '\\textbf' | '\\textit'): void {
  const event = new CustomEvent('table-formatting-request', {
    cancelable: true,
    detail: { command },
  })
  if (!window.dispatchEvent(event)) return
  run(toggleRanges(command))
}

function run(command: (editor: EditorView) => boolean): void {
  if (!view) return
  command(view)
  view.focus()
}

/**
 * Inserts a simple Overleaf-compatible table template.
 */
function insertTable(columns: number, rows: number): void {
  if (!view) return
  const body = Array.from(
    { length: rows },
    () => `\t\t${Array.from({ length: columns }, () => '').join(' & ')} \\\\`
  ).join('\n')
  const latex = `\\begin{table}\n\t\\centering\n\t\\begin{tabular}{${'c'.repeat(columns)}}\n${body}\n\t\\end{tabular}\n\t\\caption{Caption}\n\t\\label{tab:placeholder}\n\\end{table}`
  insertBlock(latex)
}

/**
 * Opens a file picker and copies the selected image through the host.
 */
function openImagePicker(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*,.pdf,.eps'
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) return
    const path = await uploadImage(file)
    openFigureDialog({ path })
  })
  input.click()
}

/**
 * Copies a browser file into the workspace assets directory.
 */
async function uploadImage(file: File): Promise<string> {
  const requestId = requestIdFor('image')
  const result = new Promise<string>(resolve => pendingImages.set(requestId, resolve))
  vscode.postMessage({
    type: 'insertImage',
    requestId,
    name: file.name,
    mimeType: file.type,
    bytes: [...new Uint8Array(await file.arrayBuffer())],
  })
  return result
}

/**
 * Inserts an Overleaf-style figure environment.
 */
function insertBlock(latex: string, position?: number): void {
  if (!view) return
  const anchor = Math.min(position ?? view.state.selection.main.head, view.state.doc.length)
  const line = view.state.doc.lineAt(anchor)
  const from = line.text.trim() ? line.to : line.from
  const prefix = line.text.trim() ? '\n\n' : ''
  view.dispatch({
    changes: { from, insert: prefix + latex + '\n' },
    selection: { anchor: from + prefix.length + latex.length },
    scrollIntoView: true,
  })
  view.focus()
}

/**
 * Handles pasted or dropped image files.
 */
function installImageDrop(): void {
  if (!view) return
  const dropCursor = document.createElement('div')
  dropCursor.className = 'latex-image-drop-cursor'
  document.body.append(dropCursor)

  const hideDropCursor = () => {
    dropCursor.classList.remove('visible')
  }
  const dropPosition = (event: DragEvent): number | null => {
    if (!view) return null
    return view.posAtCoords({ x: event.clientX, y: event.clientY })
  }
  const showDropCursor = (position: number) => {
    if (!view) return
    const coordinates = view.coordsAtPos(position)
    if (!coordinates) {
      hideDropCursor()
      return
    }
    dropCursor.style.left = `${coordinates.left}px`
    dropCursor.style.top = `${coordinates.top}px`
    dropCursor.style.height = `${coordinates.bottom - coordinates.top}px`
    dropCursor.classList.add('visible')
  }
  const handle = async (files: FileList | null, insertionPosition?: number) => {
    const file = files?.[0]
    if (!file || (!file.type.startsWith('image/') && !/\.(pdf|eps)$/i.test(file.name))) {
      return false
    }
    openFigureDialog({
      path: await uploadImage(file),
      insertionPosition,
    })
    return true
  }
  view.dom.addEventListener('dragover', event => {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    const position = dropPosition(event)
    if (position !== null) showDropCursor(position)
  })
  view.dom.addEventListener('dragleave', event => {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && view?.dom.contains(nextTarget)) return
    hideDropCursor()
  })
  view.dom.addEventListener('drop', event => {
    if (event.dataTransfer?.files.length) {
      event.preventDefault()
      const insertionPosition = dropPosition(event) ?? undefined
      hideDropCursor()
      if (insertionPosition !== undefined) {
        view?.dispatch({
          selection: { anchor: insertionPosition },
          scrollIntoView: true,
        })
      }
      void handle(event.dataTransfer.files, insertionPosition)
    }
  })
  window.addEventListener('dragend', hideDropCursor)
  view.dom.addEventListener('paste', event => {
    if (event.clipboardData?.files.length) {
      event.preventDefault()
      void handle(event.clipboardData.files)
    }
  })
}

/**
 * Edits the path and width of the figure selected by Overleaf's image widget.
 */
function editSelectedFigure(): void {
  if (!view) return
  const current = view.state.field(editFigureData, false)
  if (!current) return
  const source = view.state.sliceDoc(current.from, current.to)
  openFigureDialog({
    path: current.file.path,
    width: current.width ?? 0.5,
    placement: source.match(/\\begin\{figure\}(?:\[([^\]]+)\])?/)?.[1] ?? '',
    caption: commandArgument(source, 'caption'),
    label: commandArgument(source, 'label'),
    existing: { from: current.from, to: current.to },
  })
}

type FigureDialogData = {
  path: string
  insertionPosition?: number
  width?: number
  placement?: string
  caption?: string | null
  label?: string | null
  existing?: { from: number; to: number }
}

/**
 * Opens the local replacement for Overleaf's server-backed figure modal.
 */
function openFigureDialog(data: FigureDialogData): void {
  const backdrop = document.createElement('div')
  backdrop.className = 'latex-figure-dialog-backdrop'
  const dialog = document.createElement('form')
  dialog.className = 'latex-figure-dialog'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.innerHTML = `
    <h2>${data.existing ? 'Edit figure' : 'Insert figure'}</h2>
    <label>Image path<input name="path" required></label>
    <label>Width as fraction of line<input name="width" type="number" min="0.05" max="1" step="0.05"></label>
    <label>Placement<input name="placement" placeholder="htbp"></label>
    <label>Caption<input name="caption"></label>
    <label>Label<input name="label" placeholder="fig:example"></label>
    <div class="latex-figure-dialog-actions">
      ${data.existing ? '<button type="button" data-action="delete">Delete</button>' : ''}
      <button type="button" data-action="cancel">Cancel</button>
      <button type="submit">${data.existing ? 'Update' : 'Insert'}</button>
    </div>
  `
  backdrop.append(dialog)
  document.body.append(backdrop)

  const pathInput = dialog.elements.namedItem('path') as HTMLInputElement
  const widthInput = dialog.elements.namedItem('width') as HTMLInputElement
  const placementInput = dialog.elements.namedItem('placement') as HTMLInputElement
  const captionInput = dialog.elements.namedItem('caption') as HTMLInputElement
  const labelInput = dialog.elements.namedItem('label') as HTMLInputElement
  pathInput.value = data.path
  widthInput.value = String(data.width ?? 0.5)
  placementInput.value = data.placement ?? ''
  captionInput.value = data.caption ?? 'Enter Caption'
  labelInput.value = data.label ?? 'fig:placeholder'
  pathInput.focus()

  const close = () => {
    backdrop.remove()
    view?.focus()
  }
  dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', close)
  dialog.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
    if (view && data.existing) {
      view.dispatch({
        changes: { from: data.existing.from, to: data.existing.to, insert: '' },
      })
    }
    close()
  })
  backdrop.addEventListener('mousedown', event => {
    if (event.target === backdrop) close()
  })
  dialog.addEventListener('submit', event => {
    event.preventDefault()
    const latex = buildFigureLatex({
      path: pathInput.value,
      width: Number.parseFloat(widthInput.value) || 0.5,
      placement: placementInput.value.trim(),
      caption: captionInput.value.trim(),
      label: labelInput.value.trim(),
    })
    if (view && data.existing) {
      view.dispatch({
        changes: {
          from: data.existing.from,
          to: data.existing.to,
          insert: latex,
        },
      })
    } else {
      insertBlock(latex, data.insertionPosition)
    }
    close()
  })
}

/**
 * Creates a figure environment from dialog values.
 */
function buildFigureLatex(
  data: Required<Omit<FigureDialogData, 'existing' | 'insertionPosition'>>
): string {
  const svg = data.path.toLowerCase().endsWith('.svg')
  const command = svg ? 'includesvg' : 'includegraphics'
  const sourcePath = svg ? data.path.replace(/\.svg$/i, '') : data.path
  const placement = data.placement ? `[${data.placement}]` : ''
  const caption = data.caption ? `\n\t\\caption{${data.caption}}` : ''
  const label = data.label ? `\n\t\\label{${data.label}}` : ''
  return `\\begin{figure}${placement}\n\t\\centering\n\t\\${command}[width=${data.width}\\linewidth]{${sourcePath}}${caption}${label}\n\\end{figure}`
}

/**
 * Reads a simple command argument from a figure source block.
 */
function commandArgument(source: string, command: string): string | null {
  return source.match(new RegExp(`\\\\${command}\\{([^}]*)\\}`))?.[1] ?? null
}

/**
 * Updates toolbar state after selection changes.
 */
function updateToolbarState(): void {
  if (!view) return
  const state = view.state
  const isFormatted = withinFormattingCommand(state)
  setToolbarToggle('bold', tableFormattingState?.bold ?? isFormatted('\\textbf'))
  setToolbarToggle('italic', tableFormattingState?.italic ?? isFormatted('\\textit'))
  setToolbarToggle('quote', isFormatted('\\say'))

  const listType = ancestorListType(state)
  setToolbarToggle('bullet-list', listType === 'itemize')
  setToolbarToggle('numbered-list', listType === 'enumerate')

  const heading = document.querySelector<HTMLSelectElement>(
    '#toolbar [data-control="heading"]'
  )
  if (heading) {
    heading.value = findCurrentSectionHeadingLevel(state)?.level ?? 'text'
  }
}

function setToolbarToggle(control: string, active: boolean): void {
  const button = toolbarButton(control)
  if (!button) return
  button.setAttribute('aria-pressed', String(active))
  button.classList.toggle('active', active)
}

function toolbarButton(control: string): HTMLButtonElement | null {
  return document.querySelector(`#toolbar button[data-control="${control}"]`)
}

/**
 * Creates a collision-resistant message request identifier.
 */
function requestIdFor(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const phrases: Record<string, string> = {
  expand: 'Expand',
  learn_more: 'Learn more',
  hide_document_preamble: 'Hide document preamble',
  show_document_preamble: 'Show document preamble',
  edit_figure: 'Edit figure',
  the_visual_editor_cant_preview_this_type_of_image_file:
    'The visual editor cannot preview this image.',
  the_visual_editor_cant_preview_this_listing_file:
    'The visual editor cannot preview this listing.',
  click_recompile_and_check_your_pdf_to_see_how_its_looking:
    'Open the compiled PDF to inspect this image.',
  sorry_your_table_cant_be_displayed_at_the_moment:
    'This table cannot be displayed.',
  this_could_be_because_we_cant_support_some_elements_of_the_table:
    'The table contains unsupported LaTeX.',
}

vscode.postMessage({ type: 'ready' })


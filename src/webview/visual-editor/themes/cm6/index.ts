import { syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tagHighlighter, tags } from '@lezer/highlight'

/**
 * CodeMirror does not receive VS Code's TextMate token colors in a webview.
 * Avoid supplying a second, fixed syntax palette so all visual-editor content
 * inherits the active VS Code editor colors instead.
 */
const vscodeEditorTheme = {
  '&.cm-editor': {
    backgroundColor: 'var(--vscode-editor-background)',
    color: 'var(--vscode-editor-foreground)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--vscode-editorGutter-background)',
    color: 'var(--vscode-editorLineNumber-foreground)',
    borderRightColor: 'var(--vscode-editorGutter-border)',
  },
  '.cm-cursor, .cm-dropCursor': {
    color: 'var(--vscode-editorCursor-foreground)',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--vscode-editor-selectionBackground)',
  },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
    outline: '1px solid var(--vscode-editorBracketMatch-border)',
    backgroundColor: 'var(--vscode-editorBracketMatch-background)',
    margin: 0,
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'var(--vscode-editor-lineHighlightBackground)',
  },
  '.cm-selectionMatch.cm-selectionMatch, .cm-searchMatch.cm-searchMatch': {
    backgroundColor: 'var(--vscode-editor-findMatchHighlightBackground)',
    outline: '1px solid var(--vscode-editor-findMatchHighlightBorder)',
    margin: 0,
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--vscode-editor-foldBackground)',
    borderColor: 'var(--vscode-editor-foreground)',
  },
}

function syntaxTheme(colors: Record<string, string> = {}) {
  return Object.fromEntries(
    Object.entries(colors).map(([token, color]) => [`.tok-${token}`, { color }])
  )
}

export const themeClassHighlighter = syntaxHighlighting(
  tagHighlighter([
    { tag: tags.link, class: 'tok-link' },
    { tag: tags.heading, class: 'tok-heading' },
    { tag: tags.emphasis, class: 'tok-emphasis' },
    { tag: tags.strong, class: 'tok-strong' },
    { tag: tags.keyword, class: 'tok-keyword' },
    { tag: tags.atom, class: 'tok-atom' },
    { tag: tags.bool, class: 'tok-bool' },
    { tag: tags.url, class: 'tok-url' },
    { tag: tags.labelName, class: 'tok-labelName' },
    { tag: tags.inserted, class: 'tok-inserted' },
    { tag: tags.deleted, class: 'tok-deleted' },
    { tag: tags.literal, class: 'tok-literal' },
    { tag: tags.string, class: 'tok-string' },
    { tag: tags.number, class: 'tok-number' },
    { tag: [tags.regexp, tags.escape, tags.special(tags.string)], class: 'tok-string2' },
    { tag: tags.variableName, class: 'tok-variableName' },
    { tag: tags.typeName, class: 'tok-typeName' },
    { tag: tags.namespace, class: 'tok-namespace' },
    { tag: tags.className, class: 'tok-className' },
    { tag: tags.macroName, class: 'tok-macroName' },
    { tag: tags.propertyName, class: 'tok-propertyName' },
    { tag: tags.function(tags.variableName), class: 'tok-function' },
    { tag: tags.operator, class: 'tok-operator' },
    { tag: tags.comment, class: 'tok-comment' },
    { tag: tags.meta, class: 'tok-meta' },
    { tag: tags.invalid, class: 'tok-invalid' },
    { tag: tags.punctuation, class: 'tok-punctuation' },
    { tag: tags.attributeValue, class: 'tok-attributeValue' },
  ])
)

export function editorTheme(
  dark: boolean,
  syntaxColors: Record<string, string>
): Extension {
  return [
    EditorView.theme(vscodeEditorTheme, { dark }),
    EditorView.theme(syntaxTheme(syntaxColors), { dark }),
  ]
}

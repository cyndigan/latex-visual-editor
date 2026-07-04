import { EditorView } from '@codemirror/view'
import { syntaxHighlighting } from '@codemirror/language'
import { tagHighlighter, tags } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

type ThemeData = {
  theme: Parameters<typeof EditorView.theme>[0]
  highlightStyle: Parameters<typeof EditorView.theme>[0]
  dark: boolean
}

// Copied from Overleaf's generated CodeMirror 6 themes.
const overleafLight: ThemeData = {
  theme: {
    '.cm-gutters': { backgroundColor: 'transparent', borderRightColor: 'transparent', background: '#f0f0f0', color: '#333' },
    '&': { backgroundColor: '#FFFFFF', color: 'black' },
    '.cm-cursor, .cm-dropCursor': { color: 'black' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection, .cm-searchMatch.cm-searchMatch.cm-searchMatch-selected': { background: 'rgb(181, 213, 255)' },
    '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': { outline: '1px solid #5A5CAD', margin: 0 },
    '.cm-activeLine': { background: 'rgba(0, 0, 0, 0.07)' },
    '.cm-activeLineGutter': { backgroundColor: '#dcdcdc' },
    '.cm-selectionMatch.cm-selectionMatch, .cm-searchMatch.cm-searchMatch': { background: 'rgba(250, 250, 255, 0.5)', outline: '1px solid rgb(200, 200, 250)', margin: 0 },
    '.cm-foldPlaceholder': { backgroundColor: '#6B72E6' },
  },
  highlightStyle: {
    '.tok-comment': { color: '#0080FF', fontStyle: 'italic' },
    '.tok-typeName, .tok-keyword, .tok-labelName': { color: '#3F7F7F' },
    '.tok-attributeValue, .tok-string, .tok-number': { color: '#5A5CAD' },
  },
  dark: false,
}

const overleafDark: ThemeData = {
  theme: {
    '.cm-gutters': { backgroundColor: 'transparent', borderRightColor: 'transparent', background: '#1b222c', color: 'rgb(144,145,148)' },
    '&': { backgroundColor: '#1b222c', color: '#f8f8f2' },
    '.cm-cursor, .cm-dropCursor': { color: '#f8f8f0' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection, .cm-searchMatch.cm-searchMatch.cm-searchMatch-selected': { background: '#44475a' },
    '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': { margin: 0, outline: '1px solid #a29709' },
    '.cm-activeLine, .cm-activeLineGutter': { background: '#44475a' },
    '.cm-selectionMatch.cm-selectionMatch, .cm-searchMatch.cm-searchMatch': { boxShadow: '0px 0px 0px 1px inset #a29709', borderRadius: '3px', margin: 0 },
    '.cm-foldPlaceholder': { backgroundColor: '#50fa7b', borderColor: '#f8f8f2' },
  },
  highlightStyle: {
    '.tok-keyword, .tok-literal, .tok-tagName': { color: '#ff79c6' },
    '.tok-typeName': { color: '#8be9fd', fontStyle: 'italic' },
    '.tok-invalid': { color: '#F8F8F0', backgroundColor: '#ff79c6' },
    '.tok-string': { color: '#f1fa8c' },
    '.tok-comment': { color: '#6272a4' },
    '.tok-attributeValue': { color: '#ffb86c', fontStyle: 'italic' },
    '.tok-attributeName, .tok-function': { color: '#50fa7b' },
  },
  dark: true,
}

const vscodeEditorBackground = EditorView.theme({
  '&.cm-editor': {
    backgroundColor: 'var(--vscode-editor-background)',
  },
})

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
    { tag: tags.operator, class: 'tok-operator' },
    { tag: tags.comment, class: 'tok-comment' },
    { tag: tags.meta, class: 'tok-meta' },
    { tag: tags.invalid, class: 'tok-invalid' },
    { tag: tags.punctuation, class: 'tok-punctuation' },
    { tag: tags.attributeValue, class: 'tok-attributeValue' },
  ])
)

export function editorTheme(dark: boolean): Extension {
  const { theme, highlightStyle } = dark ? overleafDark : overleafLight
  return [
    EditorView.theme(theme, { dark }),
    EditorView.theme(highlightStyle, { dark }),
    vscodeEditorBackground,
  ]
}

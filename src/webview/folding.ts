import {
  foldEffect,
  foldable,
  foldedRanges,
  unfoldEffect,
} from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

export type FoldRange = { from: number; to: number }

/**
 * Finds foldable ranges from document lines rather than visual line blocks.
 * Visual replacements can hide structural lines from EditorView.lineBlockAt,
 * which makes CodeMirror's stock fold-all commands miss LaTeX sections.
 */
export function documentFoldRanges(state: EditorState): FoldRange[] {
  const ranges: FoldRange[] = []
  const seen = new Set<string>()

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber)
    const range = foldable(state, line.from, line.to)
    if (!range || range.from >= range.to) continue

    const key = rangeKey(range)
    if (seen.has(key)) continue
    seen.add(key)
    ranges.push(range)
  }

  return ranges.sort((a, b) => a.from - b.from || b.to - a.to)
}

export function foldAllCode(view: EditorView): boolean {
  return foldRanges(view, documentFoldRanges(view.state))
}

export function unfoldAllCode(view: EditorView): boolean {
  return unfoldRanges(view, foldedDocumentRanges(view.state))
}

export function toggleFoldCode(view: EditorView): boolean {
  const ranges = selectedToggleRanges(view.state)
  if (ranges.length === 0) return false
  const folded = foldedDocumentRanges(view.state)
  const toUnfold = ranges.filter(range => includesRange(folded, range))
  return toUnfold.length > 0
    ? unfoldRanges(view, toUnfold)
    : foldRanges(view, ranges)
}

function selectedToggleRanges(state: EditorState): FoldRange[] {
  const structural = documentFoldRanges(state)
  const folded = foldedDocumentRanges(state)
  const ranges: FoldRange[] = []
  const seen = new Set<string>()

  for (const selection of state.selection.ranges) {
    const line = state.doc.lineAt(selection.head)
    const onMarker = foldable(state, line.from, line.to)
    const containing = [...folded, ...structural]
      .filter(range => containsPosition(range, selection.head))
      .sort((a, b) => a.to - a.from - (b.to - b.from))[0]
    const range = onMarker ?? containing
    if (!range || seen.has(rangeKey(range))) continue
    seen.add(rangeKey(range))
    ranges.push(range)
  }

  return ranges
}

export function foldRecursively(view: EditorView): boolean {
  const all = documentFoldRanges(view.state)
  const roots = selectedFoldRanges(view.state)
  return foldRanges(
    view,
    all.filter(range => roots.some(root => contains(root, range)))
  )
}

export function unfoldRecursively(view: EditorView): boolean {
  const roots = selectedFoldRanges(view.state)
  const folded = foldedDocumentRanges(view.state)
  const selectedLines = selectionLineRanges(view.state)
  return unfoldRanges(
    view,
    folded.filter(range =>
      roots.length > 0
        ? roots.some(root => contains(root, range))
        : selectedLines.some(line => overlaps(line, range))
    )
  )
}

export function toggleFoldRecursively(view: EditorView): boolean {
  const roots = selectedFoldRanges(view.state)
  if (roots.length === 0) return false
  const folded = foldedDocumentRanges(view.state)
  return roots.some(root => includesRange(folded, root))
    ? unfoldRecursively(view)
    : foldRecursively(view)
}

export function foldLevel(view: EditorView, level: number): boolean {
  const all = documentFoldRanges(view.state)
  const atLevel = all.filter(
    range =>
      1 + all.filter(parent => strictlyContains(parent, range)).length === level
  )
  const unfoldEffects = foldedDocumentRanges(view.state).map(range =>
    unfoldEffect.of(range)
  )
  const foldEffects = atLevel.map(range => foldEffect.of(range))
  if (unfoldEffects.length === 0 && foldEffects.length === 0) return false
  view.dispatch({ effects: [...unfoldEffects, ...foldEffects] })
  return true
}

export function foldAllComments(view: EditorView): boolean {
  return foldRanges(view, commentFoldRanges(view.state))
}

export function unfoldAllComments(view: EditorView): boolean {
  const comments = commentFoldRanges(view.state)
  return unfoldRanges(
    view,
    foldedDocumentRanges(view.state).filter(range =>
      comments.some(comment => sameRange(comment, range))
    )
  )
}

export function foldAllExceptSelected(view: EditorView): boolean {
  const selected = view.state.selection.ranges.map(range => range.head)
  return foldRanges(
    view,
    documentFoldRanges(view.state).filter(
      range => !selected.some(position => containsPosition(range, position))
    )
  )
}

export function unfoldAllExceptSelected(view: EditorView): boolean {
  const selected = view.state.selection.ranges.map(range => range.head)
  return unfoldRanges(
    view,
    foldedDocumentRanges(view.state).filter(
      range => !selected.some(position => containsPosition(range, position))
    )
  )
}

export function createFoldingRangeFromSelection(view: EditorView): boolean {
  const ranges = view.state.selection.ranges
    .filter(selection => !selection.empty)
    .map(selection => {
      const from = Math.min(selection.from, selection.to)
      const to = Math.max(selection.from, selection.to)
      const first = view.state.doc.lineAt(from)
      const lastPosition = Math.max(from, to - (to === view.state.doc.lineAt(to).from ? 1 : 0))
      const last = view.state.doc.lineAt(lastPosition)
      return { from: first.to, to: last.to }
    })
    .filter(range => range.from < range.to)
  return foldRanges(view, ranges)
}

export function removeManualFoldingRanges(view: EditorView): boolean {
  const selectedLines = selectionLineRanges(view.state)
  return unfoldRanges(
    view,
    foldedDocumentRanges(view.state).filter(range =>
      selectedLines.some(line => overlaps(line, range))
    )
  )
}

function selectedFoldRanges(state: EditorState): FoldRange[] {
  const ranges: FoldRange[] = []
  const seen = new Set<string>()
  for (const selection of state.selection.ranges) {
    const line = state.doc.lineAt(selection.head)
    const range = foldable(state, line.from, line.to)
    if (!range || seen.has(rangeKey(range))) continue
    seen.add(rangeKey(range))
    ranges.push(range)
  }
  return ranges
}

function selectionLineRanges(state: EditorState): FoldRange[] {
  return state.selection.ranges.map(selection => {
    const line = state.doc.lineAt(selection.head)
    return { from: line.from, to: line.to }
  })
}

function commentFoldRanges(state: EditorState): FoldRange[] {
  return documentFoldRanges(state).filter(range => {
    const line = state.doc.lineAt(range.from)
    return line.text.trimStart().startsWith('%')
  })
}

function foldedDocumentRanges(state: EditorState): FoldRange[] {
  const ranges: FoldRange[] = []
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    ranges.push({ from, to })
  })
  return ranges
}

function foldRanges(view: EditorView, ranges: FoldRange[]): boolean {
  if (ranges.length === 0) return false
  view.dispatch({ effects: ranges.map(range => foldEffect.of(range)) })
  return true
}

function unfoldRanges(view: EditorView, ranges: FoldRange[]): boolean {
  if (ranges.length === 0) return false
  view.dispatch({ effects: ranges.map(range => unfoldEffect.of(range)) })
  return true
}

function rangeKey(range: FoldRange): string {
  return `${range.from}:${range.to}`
}

function sameRange(a: FoldRange, b: FoldRange): boolean {
  return a.from === b.from && a.to === b.to
}

function includesRange(ranges: FoldRange[], target: FoldRange): boolean {
  return ranges.some(range => sameRange(range, target))
}

function contains(outer: FoldRange, inner: FoldRange): boolean {
  return outer.from <= inner.from && outer.to >= inner.to
}

function strictlyContains(outer: FoldRange, inner: FoldRange): boolean {
  return contains(outer, inner) && !sameRange(outer, inner)
}

function containsPosition(range: FoldRange, position: number): boolean {
  return range.from <= position && range.to >= position
}

function overlaps(a: FoldRange, b: FoldRange): boolean {
  return a.from <= b.to && b.from <= a.to
}

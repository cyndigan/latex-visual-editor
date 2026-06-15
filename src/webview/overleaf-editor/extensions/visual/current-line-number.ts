import { RangeSet } from '@codemirror/state'
import { GutterMarker, gutterLineClass } from '@codemirror/view'

class CurrentLineNumberMarker extends GutterMarker {
  elementClass = 'latex-visual-current-line-number'
}

const currentLineNumberMarker = new CurrentLineNumberMarker()

/**
 * Adds a stable, editor-specific class to the line-number cell containing the
 * main cursor. This avoids relying on CodeMirror's themeable active-line class.
 */
export const highlightCurrentLineNumber = gutterLineClass.compute(
  ['selection', 'doc'],
  state => {
    const line = state.doc.lineAt(state.selection.main.head)
    return RangeSet.of(currentLineNumberMarker.range(line.from))
  }
)

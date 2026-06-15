import { EditorView, WidgetType } from '@codemirror/view'
import { placeSelectionInsideBlock } from '../selection'
import { isEqual } from 'lodash'
import { FigureData } from '../../figure-modal'
import type { PreviewPath } from '../../../../adapters/previewPath'

/**
 * Displays a workspace graphics resource resolved by the VS Code host.
 */
export class GraphicsWidget extends WidgetType {
  destroyed = false
  height = 300

  constructor(
    public filePath: string,
    public previewByPath: (path: string) => PreviewPath | null,
    public centered: boolean,
    public figureData: FigureData | null
  ) {
    super()
  }

  toDOM(view: EditorView): HTMLElement {
    this.destroyed = false
    const element = document.createElement('div')
    element.classList.add('ol-cm-environment-figure', 'ol-cm-environment-line')
    element.classList.toggle('ol-cm-environment-centered', this.centered)
    this.renderGraphic(element, view)
    element.addEventListener('mouseup', event => {
      event.preventDefault()
      view.dispatch(placeSelectionInsideBlock(view, event))
    })
    return element
  }

  eq(widget: GraphicsWidget): boolean {
    return (
      widget.filePath === this.filePath &&
      widget.centered === this.centered &&
      isEqual(this.figureData, widget.figureData)
    )
  }

  updateDOM(element: HTMLElement, view: EditorView): boolean {
    this.destroyed = false
    element.classList.toggle('ol-cm-environment-centered', this.centered)
    if (
      this.filePath !== element.dataset.filepath ||
      element.dataset.width !== String(this.figureData?.width)
    ) {
      this.renderGraphic(element, view)
      view.requestMeasure()
    }
    return true
  }

  ignoreEvent(event: Event): boolean {
    return (
      event.type !== 'mouseup' &&
      !(
        event.target instanceof HTMLElement &&
        event.target.closest('.ol-cm-graphics-edit-button')
      )
    )
  }

  destroy(): void {
    this.destroyed = true
  }

  coordsAt(element: HTMLElement): DOMRect {
    return element.getBoundingClientRect()
  }

  get estimatedHeight(): number {
    return this.height
  }

  /**
   * Rebuilds the image preview for the current graphics path.
   */
  renderGraphic(element: HTMLElement, view: EditorView): void {
    element.replaceChildren()
    const preview = this.previewByPath(this.filePath)
    element.dataset.filepath = this.filePath
    element.dataset.width = String(this.figureData?.width)

    if (!preview || preview.extension.toLowerCase() === 'pdf') {
      element.append(this.createErrorElement(view))
      return
    }

    const image = document.createElement('img')
    image.className = 'ol-cm-graphics ol-cm-graphics-loading'
    image.src = preview.url
    const width = this.figureData?.width
      ? `min(100%, ${this.figureData.width * 100}%)`
      : ''
    image.style.width = width
    image.style.maxWidth = width
    image.addEventListener('load', () => {
      image.classList.remove('ol-cm-graphics-loading')
      this.height = image.height
      view.requestMeasure()
    })
    image.addEventListener('error', () => {
      element.replaceChildren(this.createErrorElement(view))
      view.requestMeasure()
    })
    element.append(image)
  }

  /**
   * Creates a localized preview error.
   */
  createErrorElement(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'ol-cm-graphics-loading-error'
    const title = document.createElement('strong')
    title.textContent = view.state.phrase(
      'the_visual_editor_cant_preview_this_type_of_image_file'
    )
    const path = document.createElement('span')
    path.textContent = this.filePath
    wrapper.append(title, path)
    return wrapper
  }
}

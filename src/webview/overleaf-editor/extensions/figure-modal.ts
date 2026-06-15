import { ChangeSet, StateEffect, StateField } from '@codemirror/state'

type FigureDataProps = {
  from: number
  to: number
  caption: { from: number; to: number } | null
  label: { from: number; to: number } | null
  width?: number
  unknownGraphicsArguments?: string
  graphicsCommandArguments: { from: number; to: number } | null
  graphicsCommand: { from: number; to: number }
  file: { from: number; to: number; path: string }
}

/**
 * Stores source ranges belonging to a parsed LaTeX figure.
 */
export class FigureData {
  constructor(private readonly props: Readonly<FigureDataProps>) {}

  get from() { return this.props.from }
  get to() { return this.props.to }
  get caption() { return this.props.caption }
  get label() { return this.props.label }
  get width() { return this.props.width }
  get unknownGraphicsArguments() { return this.props.unknownGraphicsArguments }
  get graphicsCommandArguments() { return this.props.graphicsCommandArguments }
  get graphicsCommand() { return this.props.graphicsCommand }
  get file() { return this.props.file }

  /**
   * Maps figure ranges through a CodeMirror change set.
   */
  map(changes: ChangeSet): FigureData {
    const mapRange = <T extends { from: number; to: number } | null>(range: T): T =>
      range
        ? ({ ...range, from: changes.mapPos(range.from), to: changes.mapPos(range.to) } as T)
        : range
    return new FigureData({
      ...this.props,
      from: changes.mapPos(this.from),
      to: changes.mapPos(this.to),
      caption: mapRange(this.caption),
      label: mapRange(this.label),
      graphicsCommandArguments: mapRange(this.graphicsCommandArguments),
      graphicsCommand: mapRange(this.graphicsCommand),
      file: mapRange(this.file),
    })
  }
}

export const editFigureDataEffect = StateEffect.define<FigureData | null>()

export const editFigureData = StateField.define<FigureData | null>({
  create: () => null,
  update(current, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(editFigureDataEffect)) return effect.value
    }
    return current?.map(transaction.changes) ?? null
  },
})

/**
 * Installs state used by editable graphics widgets.
 */
export const figureModal = () => editFigureData

import type { WidthSelection } from './toolbar/column-width-modal/column-width'

export type ColumnDefinition = {
  alignment: 'left' | 'center' | 'right' | 'paragraph'
  borderLeft: number
  borderRight: number
  content: string
  cellSpacingLeft: string
  cellSpacingRight: string
  customCellDefinition: string
  isParagraphColumn: boolean
  size?: WidthSelection
}

export type CellData = {
  content: string
  from: number
  to: number
  multiColumn?: {
    columnSpan: number
    columns: {
      specification: ColumnDefinition[]
      from: number
      to: number
    }
    from: number
    to: number
    preamble: { from: number; to: number }
    postamble: { from: number; to: number }
  }
}

export type RowData = {
  cells: CellData[]
  borderTop: number
  borderBottom: number
}

/**
 * Stores the parsed rows and columns of a visual LaTeX table.
 */
export class TableData {
  constructor(
    public readonly rows: RowData[],
    public readonly columns: ColumnDefinition[]
  ) {}
}

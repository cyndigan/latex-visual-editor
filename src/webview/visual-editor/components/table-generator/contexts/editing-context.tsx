import { createContext, useContext } from 'react'

export type EditingCell = {
  row: number
  cellIndex: number
  content: string
  initial: string
  wrapper?: { prefix: string; suffix: string }
}

export type EditingContextValue = {
  editing: EditingCell | null
  startEditing(row: number, cellIndex: number, source: string, initial?: string): void
  updateDraft(content: string): void
  commitEditing(restoreFocus?: boolean): void
  cancelEditing(): void
}

export const EditingContext = createContext<EditingContextValue | null>(null)

export function useTableEditing() {
  const value = useContext(EditingContext)
  if (!value) throw new Error('Table editing context is missing')
  return value
}

import { useLayoutEffect, useRef } from 'react'
import { useTableEditing } from './contexts/editing-context'

const filterInput = (value: string) =>
  value
    .replace(/(^|[^\\])&/g, '$1\\&')
    .replace(/(^|[^\\])%/g, '$1\\%')
    .replaceAll('\\\\', '')

export function toggleTextFormatting(
  content: string,
  from: number,
  to: number,
  command: '\\textbf' | '\\textit'
) {
  const prefix = `${command}{`
  const selectsFormattedText =
    content.slice(from - prefix.length, from) === prefix && content[to] === '}'
  const selectsWholeCommand =
    content.slice(from, from + prefix.length) === prefix && content[to - 1] === '}'

  if (selectsFormattedText) {
    return {
      content:
        content.slice(0, from - prefix.length) + content.slice(from, to) +
        content.slice(to + 1),
      from: from - prefix.length,
      to: to - prefix.length,
    }
  }

  if (selectsWholeCommand) {
    return {
      content:
        content.slice(0, from) + content.slice(from + prefix.length, to - 1) +
        content.slice(to),
      from,
      to: to - prefix.length - 1,
    }
  }

  return {
    content: content.slice(0, from) + prefix + content.slice(from, to) +
      '}' + content.slice(to),
    from: from + prefix.length,
    to: to + prefix.length,
  }
}

export function CellInput() {
  const { editing, updateDraft, commitEditing, cancelEditing } =
    useTableEditing()
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const input = ref.current
    if (!input || !editing) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
    input.style.height = '1px'
    input.style.height = `${Math.max(30, input.scrollHeight)}px`
  }, [])

  if (!editing) return null
  return (
    <textarea
      ref={ref}
      className="table-generator-cell-input"
      value={editing.content}
      onChange={event => {
        const input = event.currentTarget
        const filtered = filterInput(input.value)
        const caret =
          input.selectionStart + filtered.length - input.value.length
        updateDraft(filtered)
        requestAnimationFrame(() => {
          input.setSelectionRange(caret, caret)
          input.style.height = '1px'
          input.style.height = `${Math.max(30, input.scrollHeight)}px`
        })
      }}
      onBlur={() => commitEditing(false)}
      onKeyDown={event => {
        const command = event.ctrlKey || event.metaKey
        const key = event.key.toLowerCase()
        if (command && !event.altKey && (key === 'b' || key === 'i')) {
          event.preventDefault()
          event.stopPropagation()
          const next = toggleTextFormatting(
            editing.content,
            event.currentTarget.selectionStart,
            event.currentTarget.selectionEnd,
            key === 'b' ? '\\textbf' : '\\textit'
          )
          updateDraft(next.content)
          requestAnimationFrame(() => {
            ref.current?.setSelectionRange(next.from, next.to)
          })
        } else if (event.key === 'Escape') {
          event.preventDefault()
          cancelEditing()
        } else if (event.key === 'Tab') {
          event.preventDefault()
          commitEditing()
        }
      }}
    />
  )
}

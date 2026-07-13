import { describe, expect, it } from 'vitest'
import { toggleTextFormatting } from './cell-input'

describe('toggleTextFormatting', () => {
  it.each([
    ['\\textbf', 'bold'],
    ['\\textit', 'italic'],
  ] as const)('wraps a selected range in %s', (command, text) => {
    expect(toggleTextFormatting(`before ${text} after`, 7, 7 + text.length, command))
      .toEqual({
        content: `before ${command}{${text}} after`,
        from: 7 + command.length + 1,
        to: 7 + command.length + 1 + text.length,
      })
  })

  it('removes formatting when its whole text range is selected', () => {
    expect(toggleTextFormatting('\\textbf{bold}', 8, 12, '\\textbf')).toEqual({
      content: 'bold', from: 0, to: 4,
    })
  })

  it('removes formatting when the complete command is selected', () => {
    expect(toggleTextFormatting('\\textit{italic}', 0, 15, '\\textit')).toEqual({
      content: 'italic', from: 0, to: 6,
    })
  })
})

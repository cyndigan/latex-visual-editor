import { describe, expect, it } from 'vitest'
import { findMinimalTextChange } from './textChange'

describe('findMinimalTextChange', () => {
  it('returns a targeted insertion', () => {
    expect(findMinimalTextChange('hello world', 'hello brave world')).toEqual({
      from: 6,
      to: 6,
      insert: 'brave ',
    })
  })

  it('returns a targeted deletion', () => {
    expect(findMinimalTextChange('abcXYZdef', 'abcdef')).toEqual({
      from: 3,
      to: 6,
      insert: '',
    })
  })

  it('does not rewrite equal text', () => {
    expect(findMinimalTextChange('same', 'same')).toEqual({
      from: 4,
      to: 4,
      insert: '',
    })
  })
})

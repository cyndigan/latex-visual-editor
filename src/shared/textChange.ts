export type MinimalTextChange = {
  from: number
  to: number
  insert: string
}

/**
 * Finds the smallest single replacement that transforms one string into another.
 */
export function findMinimalTextChange(
  before: string,
  after: string
): MinimalTextChange {
  let prefix = 0
  const maxPrefix = Math.min(before.length, after.length)
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) {
    suffix += 1
  }

  return {
    from: prefix,
    to: before.length - suffix,
    insert: after.slice(prefix, after.length - suffix),
  }
}

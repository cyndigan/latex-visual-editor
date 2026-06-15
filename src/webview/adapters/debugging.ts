/**
 * Console adapter used by vendored Overleaf modules.
 */
export const debugConsole = {
  log: (...values: unknown[]) => console.log(...values),
  warn: (...values: unknown[]) => console.warn(...values),
  error: (...values: unknown[]) => console.error(...values),
}

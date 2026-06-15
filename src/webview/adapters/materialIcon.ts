/**
 * Creates a lightweight text icon compatible with Overleaf widget markup.
 */
export function materialIcon(name: string): HTMLElement {
  const element = document.createElement('span')
  element.className = 'material-symbols'
  element.textContent =
    {
      edit: '✎',
      expand_more: '⌄',
      help: '?',
      info: 'i',
    }[name] ?? name
  element.setAttribute('aria-hidden', 'true')
  return element
}

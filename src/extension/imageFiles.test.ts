import * as vscode from 'vscode'
import { describe, expect, it, vi } from 'vitest'
import { isUriInsideRoot, sanitizeImageBaseName } from './imageFiles'

vi.mock('vscode', () => ({
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
  },
}))

describe('image path safety', () => {
  it('rejects sibling-prefix and traversal paths', () => {
    const root = vscode.Uri.file('C:\\workspace\\paper')
    expect(
      isUriInsideRoot(
        vscode.Uri.file('C:\\workspace\\paper\\assets\\a.png'),
        root
      )
    ).toBe(true)
    expect(
      isUriInsideRoot(vscode.Uri.file('C:\\workspace\\paper-evil\\a.png'), root)
    ).toBe(false)
    expect(
      isUriInsideRoot(vscode.Uri.file('C:\\workspace\\secret.png'), root)
    ).toBe(false)
  })

  it('creates portable image basenames', () => {
    expect(sanitizeImageBaseName('My diagram (final)')).toBe('My-diagram-final')
    expect(sanitizeImageBaseName('***')).toBe('image')
  })
})

import * as vscode from 'vscode'
import { describe, expect, it, vi } from 'vitest'
import {
  ImageFileService,
  isUriInsideRoot,
  sanitizeImageBaseName,
} from './imageFiles'

vi.mock('vscode', () => ({
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
    joinPath: (base: { fsPath: string }, child: string) => ({
      fsPath: `${base.fsPath}\\${child.replaceAll('/', '\\')}`,
    }),
  },
  workspace: {
    fs: {
      stat: vi.fn(),
    },
  },
  FileType: {
    File: 1,
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

  it('resolves document-relative files without an open workspace folder', async () => {
    vi.mocked(vscode.workspace.fs.stat).mockImplementation(uri =>
      uri.fsPath === 'C:\\paper\\figure.pdf'
        ? Promise.resolve({ type: vscode.FileType.File } as never)
        : Promise.reject(new Error('missing file'))
    )
    const service = new ImageFileService(
      { uri: vscode.Uri.file('C:\\paper\\main.tex') } as never,
      undefined
    )

    await expect(service.resolve('figure.pdf')).resolves.toEqual(
      vscode.Uri.file('C:\\paper\\figure.pdf')
    )
  })

  it('resolves workspace-relative graphics from included chapter files', async () => {
    vi.mocked(vscode.workspace.fs.stat)
      .mockRejectedValueOnce(new Error('no chapter main.tex'))
      .mockResolvedValueOnce({ type: vscode.FileType.File } as never)
      .mockResolvedValueOnce({ type: vscode.FileType.File } as never)
    const service = new ImageFileService(
      { uri: vscode.Uri.file('C:\\paper\\Chapters\\02_Theory.tex') } as never,
      { uri: vscode.Uri.file('C:\\paper') } as never
    )

    await expect(service.resolve('Images/figure.pdf')).resolves.toEqual(
      vscode.Uri.file('C:\\paper\\Images\\figure.pdf')
    )
  })

  it('uses the nearest ancestor main.tex as the graphics root', async () => {
    vi.mocked(vscode.workspace.fs.stat).mockImplementation(uri => {
      if (uri.fsPath === 'C:\\workspace\\thesis\\main.tex') {
        return Promise.resolve({ type: vscode.FileType.File } as never)
      }
      if (uri.fsPath === 'C:\\workspace\\thesis\\Images\\figure.pdf') {
        return Promise.resolve({ type: vscode.FileType.File } as never)
      }
      return Promise.reject(new Error('missing file'))
    })
    const service = new ImageFileService(
      { uri: vscode.Uri.file('C:\\workspace\\thesis\\Chapters\\02_Theory.tex') } as never,
      { uri: vscode.Uri.file('C:\\workspace') } as never
    )

    await expect(service.resolve('Images/figure.pdf')).resolves.toEqual(
      vscode.Uri.file('C:\\workspace\\thesis\\Images\\figure.pdf')
    )
  })
})

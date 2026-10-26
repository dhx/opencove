import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDroppedFileInBrowser } from '../../../src/app/renderer/browser/browserFileDrop'
import {
  readBrowserDroppedFiles,
  resolveBrowserDropDirectory,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/browserCanvasFileDrop'
import type { WorkspaceSpaceState } from '../../../src/contexts/workspace/presentation/renderer/types'

function transferOf(entries: Array<{ file: File; isDirectory?: boolean }>): DataTransfer {
  return {
    items: entries.map(({ file, isDirectory }) => ({
      kind: 'file',
      type: file.type,
      getAsFile: () => file,
      webkitGetAsEntry: () => ({ isDirectory: isDirectory === true, isFile: !isDirectory }),
    })),
    files: entries.map(entry => entry.file),
  } as unknown as DataTransfer
}

describe('Files dropped onto the canvas in the Web UI', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('splits uploads, images and folders', () => {
    const notes = new File(['n'], 'notes.txt', { type: 'text/plain' })
    const shot = new File(['p'], 'shot.png', { type: 'image/png' })
    const folder = new File([], 'docs', { type: '' })
    expect(
      readBrowserDroppedFiles(
        transferOf([{ file: notes }, { file: shot }, { file: folder, isDirectory: true }]),
      ),
    ).toEqual({ files: [notes], images: [shot], folderCount: 1 })
  })

  it('go to the space’s own folder, else the project root', () => {
    const space = (directoryPath: string, targetMountId: string | null = null) =>
      ({ id: 's', directoryPath, targetMountId }) as unknown as WorkspaceSpaceState
    expect(resolveBrowserDropDirectory(space('/p/feature'), '/p')).toBe('/p/feature')
    expect(resolveBrowserDropDirectory(space(''), '/p')).toBe('/p')
    expect(resolveBrowserDropDirectory(space('/remote', 'mount-1'), '/p')).toBe('/p')
    expect(resolveBrowserDropDirectory(null, '/p')).toBe('/p')
    expect(resolveBrowserDropDirectory(null, undefined)).toBeNull()
  })

  it('are uploaded into the target directory and answered as the new file', async () => {
    const stat = { uri: 'file:///p/dropped/a.txt', kind: 'file', sizeBytes: 1, mtimeMs: 1 }
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url === '/files/drop'
        ? new Response(
            JSON.stringify({ ok: true, path: '/p/dropped/a.txt', uri: 'file:///p/dropped/a.txt' }),
          )
        : new Response(JSON.stringify({ __opencoveControlEnvelope: true, ok: true, value: stat })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await resolveDroppedFileInBrowser(new File(['a'], 'a.txt'), {
      targetDirectoryPath: '/p',
    })
    expect(result).toEqual(stat)
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      'x-opencove-drop': '1',
      'x-drop-directory': encodeURIComponent('/p'),
    })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      kind: 'query',
      id: 'filesystem.stat',
      payload: { uri: 'file:///p/dropped/a.txt' },
    })
  })

  it('upload nothing without a target directory', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await resolveDroppedFileInBrowser(new File(['a'], 'a.txt'))).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

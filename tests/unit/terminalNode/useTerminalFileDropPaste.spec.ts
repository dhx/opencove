import { describe, expect, it, vi } from 'vitest'
import { resolveDroppedFilePaths } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalFileDropPaste'

describe('Paths of files dropped onto a terminal', () => {
  const a = new File(['a'], 'a.txt')
  const b = new File(['b'], 'b.png')

  it('uses each file’s own path in the desktop app', async () => {
    const upload = vi.fn()
    const paths = await resolveDroppedFilePaths([a, b], {
      getPathForFile: file => `/home/me/${file.name}`,
      uploadDroppedFile: upload,
    })
    expect(paths).toEqual(['/home/me/a.txt', '/home/me/b.png'])
    expect(upload).not.toHaveBeenCalled()
  })

  it('uploads files without a path in the Web UI', async () => {
    const paths = await resolveDroppedFilePaths([a, b], {
      getPathForFile: () => '',
      uploadDroppedFile: async file => `/data/drops/2026-10-25/${file.name}`,
    })
    expect(paths).toEqual(['/data/drops/2026-10-25/a.txt', '/data/drops/2026-10-25/b.png'])
  })

  it('leaves out files it can neither name nor upload', async () => {
    const paths = await resolveDroppedFilePaths([a], { getPathForFile: () => '' })
    expect(paths).toEqual([])
  })
})

// @vitest-environment node

import { mkdtemp, mkdir, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  handleFileDropRoute,
  MAX_FILE_DROP_BYTES,
  safeFileName,
  saveDroppedFile,
} from '../../../src/app/main/controlSurface/http/fileDropRoute'

const now = new Date('2026-10-25T12:00:00.000Z')

function response() {
  const out = {
    statusCode: 0,
    body: '',
    setHeader: vi.fn(),
    end: vi.fn((b: string) => (out.body = b)),
  }
  return out
}

describe('Files dropped onto a terminal in the Web UI', () => {
  it('are kept under the day with a safe name, never over another file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'drops-'))
    const day = join(dir, '2026-10-25')
    const save = (name: string) =>
      saveDroppedFile(dir, name, Readable.from([`bytes of ${name}`]), now)
    // One after another: the second "shot 1.png" must find the first.
    const paths = [await save('shot 1.png'), await save('shot 1.png')]
    paths.push(...(await Promise.all([save('../../etc/passwd'), save('')])))
    expect(paths).toEqual([
      join(day, 'shot_1.png'),
      join(day, 'shot_1-2.png'),
      join(day, 'passwd'),
      join(day, 'pasted'),
    ])
    expect(await readFile(paths[1], 'utf8')).toBe('bytes of shot 1.png')
    expect((await stat(paths[0])).mode & 0o777).toBe(0o600)
  })

  it('removes days older than a week', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'drops-'))
    await mkdir(join(dir, '2026-10-10'))
    await mkdir(join(dir, '2026-10-20'))
    await saveDroppedFile(dir, 'a.txt', Readable.from(['a']), now)
    await expect(stat(join(dir, '2026-10-10'))).rejects.toThrow()
    await expect(stat(join(dir, '2026-10-20'))).resolves.toBeTruthy()
  })

  it('answers the path, and refuses a body larger than the limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'drops-'))
    const req = Object.assign(Readable.from(['hello']), {
      headers: { 'x-file-name': encodeURIComponent('my notes.txt') },
    })
    const res = response()
    await handleFileDropRoute({ req: req as never, res: res as never, dropsDirectory: dir, now })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      path: join(dir, '2026-10-25', 'my_notes.txt'),
    })

    const big = Object.assign(Readable.from([]), {
      headers: { 'content-length': String(MAX_FILE_DROP_BYTES + 1) },
    })
    const tooLarge = response()
    await handleFileDropRoute({
      req: big as never,
      res: tooLarge as never,
      dropsDirectory: dir,
      now,
    })
    expect(tooLarge.statusCode).toBe(413)
  })

  it('makes names safe', () => {
    expect(safeFileName('a b/c.d.txt')).toEqual({ base: 'c.d', ext: '.txt' })
    expect(safeFileName('..\\..\\x.png')).toEqual({ base: 'x', ext: '.png' })
    expect(safeFileName('.hidden')).toEqual({ base: 'hidden', ext: '' })
  })
})

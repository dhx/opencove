// @vitest-environment node

import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  FileDropRejectedError,
  handleFileDropRoute,
  saveDroppedFileIntoProject,
} from '../../../src/app/main/controlSurface/http/fileDropRoute'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'

const now = new Date('2026-10-25T12:00:00.000Z')

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'project-drops-'))
  const project = join(base, 'project')
  const outside = join(base, 'outside')
  await mkdir(join(project, 'src'), { recursive: true })
  await mkdir(outside)
  const approved = createApprovedWorkspaceStoreForPath(join(base, 'approved.json'))
  await approved.registerRoot(project)
  return { base, project, outside, approved }
}

const body = (text: string) => Readable.from([text])

function response() {
  const out = {
    statusCode: 0,
    body: '',
    setHeader: vi.fn(),
    end: vi.fn((b: string) => (out.body = b)),
  }
  return out
}

describe('Files dropped onto the canvas in the Web UI', () => {
  it('go to <dir>/dropped/ inside an approved project, never over another file', async () => {
    const { project, approved } = await fixture()
    const first = await saveDroppedFileIntoProject(project, 'my notes.txt', body('one'), approved)
    const second = await saveDroppedFileIntoProject(project, 'my notes.txt', body('two'), approved)
    const nested = await saveDroppedFileIntoProject(
      join(project, 'src'),
      '../../etc/passwd',
      body('three'),
      approved,
    )
    expect([first, second, nested]).toEqual([
      join(project, 'dropped', 'my_notes.txt'),
      join(project, 'dropped', 'my_notes-2.txt'),
      join(project, 'src', 'dropped', 'passwd'),
    ])
    expect(await readFile(first, 'utf8')).toBe('one')
    expect(await readFile(second, 'utf8')).toBe('two')
    // A project file, readable like the rest of the project.
    expect((await stat(first)).mode & 0o600).toBe(0o600)
  })

  it('refuse directories outside the approved roots, also through .. or symlinks', async () => {
    const { project, outside, approved } = await fixture()
    await symlink(outside, join(project, 'link-out'))
    const attempts = [
      outside,
      join(project, '..', 'outside'),
      join(project, 'link-out'),
      '/',
      tmpdir(),
    ]
    for (const directory of attempts) {
      // eslint-disable-next-line no-await-in-loop
      await expect(
        saveDroppedFileIntoProject(directory, 'x.txt', body('x'), approved),
        directory,
      ).rejects.toMatchObject({ status: 403 })
    }
    await expect(stat(join(outside, 'dropped'))).rejects.toThrow()
  })

  it('refuse a dropped folder that links out of the project', async () => {
    const { project, outside, approved } = await fixture()
    await symlink(outside, join(project, 'dropped'))
    await expect(
      saveDroppedFileIntoProject(project, 'x.txt', body('x'), approved),
    ).rejects.toBeInstanceOf(FileDropRejectedError)
    await expect(stat(join(outside, 'x.txt'))).rejects.toThrow()
  })

  it('refuse relative, missing and non-folder directories', async () => {
    const { project, approved } = await fixture()
    await writeFile(join(project, 'file.txt'), 'x')
    for (const directory of ['project', '', join(project, 'missing'), join(project, 'file.txt')]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(
        saveDroppedFileIntoProject(directory, 'x.txt', body('x'), approved),
        directory,
      ).rejects.toMatchObject({ status: 400 })
    }
  })

  it('answer the path and file URI through the route, and 403 without an approval store', async () => {
    const { base, project, approved } = await fixture()
    const req = Object.assign(body('hello'), {
      headers: {
        'x-file-name': encodeURIComponent('read me.md'),
        'x-drop-directory': encodeURIComponent(project),
      },
    })
    const res = response()
    await handleFileDropRoute({
      req: req as never,
      res: res as never,
      dropsDirectory: join(base, 'drops'),
      now,
      approvedWorkspaces: approved,
    })
    const path = join(project, 'dropped', 'read_me.md')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, path, uri: pathToFileURL(path).href })

    const refused = response()
    await handleFileDropRoute({
      req: Object.assign(body('hello'), {
        headers: { 'x-drop-directory': encodeURIComponent(project) },
      }) as never,
      res: refused as never,
      dropsDirectory: join(base, 'drops'),
      now,
    })
    expect(refused.statusCode).toBe(403)
    // Without the header, the terminal drops folder is used as before.
    await expect(stat(join(base, 'drops'))).rejects.toThrow()
  })
})

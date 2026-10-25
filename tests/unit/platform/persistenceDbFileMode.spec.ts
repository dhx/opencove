// @vitest-environment node

import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  backupDbFile,
  ensurePrivateDbFile,
  moveCorruptDbAside,
} from '../../../src/platform/persistence/sqlite/dbFiles'

const describePosix = process.platform === 'win32' ? describe.skip : describe

async function modeOf(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777
}

describePosix('persistence database file mode', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(directories.map(async dir => await rm(dir, { recursive: true, force: true })))
    directories.length = 0
  })

  async function createDirectory(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'opencove-db-mode-'))
    directories.push(dir)
    return dir
  }

  it('creates a new database file readable by the owner only', async () => {
    const dbPath = join(await createDirectory(), 'opencove.db')
    await ensurePrivateDbFile(dbPath)
    expect(await modeOf(dbPath)).toBe(0o600)
    expect((await stat(dbPath)).size).toBe(0)
  })

  it('tightens an existing database and its SQLite sidecar files', async () => {
    const dbPath = join(await createDirectory(), 'opencove.db')
    const paths = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]
    await Promise.all(
      paths.map(async path => {
        await writeFile(path, 'x')
        await chmod(path, 0o644)
      }),
    )

    await ensurePrivateDbFile(dbPath)

    expect(await Promise.all(paths.map(modeOf))).toEqual([0o600, 0o600, 0o600])
  })

  it('keeps backups and corrupt copies owner-only', async () => {
    const dbPath = join(await createDirectory(), 'opencove.db')
    await writeFile(dbPath, 'data')
    await chmod(dbPath, 0o644)

    const backupPath = await backupDbFile(dbPath, new Date('2026-10-25T00:00:00.000Z'))
    expect(backupPath).not.toBeNull()
    expect(await modeOf(backupPath!)).toBe(0o600)

    const corruptPath = await moveCorruptDbAside(dbPath, new Date('2026-10-25T00:00:01.000Z'))
    expect(corruptPath).not.toBeNull()
    expect(await modeOf(corruptPath!)).toBe(0o600)
  })
})

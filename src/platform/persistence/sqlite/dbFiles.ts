import { chmod, copyFile, open, rename, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/** opencove.db holds prompts and terminal scrollback: only the owner may read it. */
export const PRIVATE_DB_FILE_MODE = 0o600

const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'] as const

function formatFileTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function chmodPrivateIfExists(path: string): Promise<void> {
  if (process.platform === 'win32') {
    return
  }
  try {
    await chmod(path, PRIVATE_DB_FILE_MODE)
  } catch {
    // Best effort: a missing sidecar, or a file we do not own, must not block startup.
  }
}

/**
 * Create the database file owner-only before SQLite opens it (SQLite gives its -wal/-shm files
 * the database file's mode), and tighten files created by older versions with the default umask.
 * Best effort: any failure here is left for SQLite's own open to report.
 */
export async function ensurePrivateDbFile(dbPath: string): Promise<void> {
  if (process.platform === 'win32' || dbPath.length === 0 || dbPath.startsWith(':memory:')) {
    return
  }
  try {
    const handle = await open(dbPath, 'a', PRIVATE_DB_FILE_MODE)
    await handle.close()
  } catch {
    return
  }
  await chmodPrivateIfExists(dbPath)
  await Promise.all(
    SQLITE_SIDECAR_SUFFIXES.map(async suffix => await chmodPrivateIfExists(`${dbPath}${suffix}`)),
  )
}

export async function backupDbFile(dbPath: string, now: Date): Promise<string | null> {
  if (!(await fileExists(dbPath))) {
    return null
  }

  const stamp = formatFileTimestamp(now)
  const backupPath = resolve(dirname(dbPath), `opencove.db.bak-${stamp}`)

  await copyFile(dbPath, backupPath)
  await chmodPrivateIfExists(backupPath)
  return backupPath
}

export async function moveCorruptDbAside(dbPath: string, now: Date): Promise<string | null> {
  if (!(await fileExists(dbPath))) {
    return null
  }

  const stamp = formatFileTimestamp(now)
  const nextPath = resolve(dirname(dbPath), `opencove.db.corrupt-${stamp}`)

  await rename(dbPath, nextPath)
  await chmodPrivateIfExists(nextPath)
  return nextPath
}

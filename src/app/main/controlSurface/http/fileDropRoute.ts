import { mkdir, open, readdir, rm, type FileHandle } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { basename, extname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { sendJson } from './httpJson'

/**
 * Files dropped or pasted onto a terminal in the Web UI.
 *
 * The desktop app pastes a dropped file's own path; a browser cannot tell the page where a file
 * lives. The Web UI therefore uploads the file here, the worker keeps it under
 * `<userData>/drops/<day>/`, and the page pastes the path it answers. Days older than a week are
 * removed on the next upload.
 */

export const FILE_DROP_PATH = '/files/drop'
export const MAX_FILE_DROP_BYTES = 100 * 1024 * 1024
const KEEP_DROP_DAYS = 7

export async function handleFileDropRoute(options: {
  req: IncomingMessage
  res: ServerResponse
  dropsDirectory: string
  now: Date
}): Promise<void> {
  const { req, res } = options
  const declared = Number.parseInt(String(req.headers['content-length'] ?? ''), 10)
  if (Number.isFinite(declared) && declared > MAX_FILE_DROP_BYTES) {
    sendJson(res, 413, { ok: false, error: `Files up to ${MAX_FILE_DROP_BYTES / 1024 / 1024} MB.` })
    req.resume()
    return
  }

  const nameHeader = req.headers['x-file-name']
  let name = typeof nameHeader === 'string' ? nameHeader : ''
  try {
    name = decodeURIComponent(name)
  } catch {
    // keep the raw header
  }

  try {
    const path = await saveDroppedFile(options.dropsDirectory, name, req, options.now)
    sendJson(res, 200, { ok: true, path })
  } catch (error) {
    if (error instanceof FileDropTooLargeError) {
      sendJson(res, 413, { ok: false, error: error.message })
      return
    }
    sendJson(res, 500, { ok: false, error: 'The file could not be saved.' })
  }
}

class FileDropTooLargeError extends Error {}

/** Writes the body under `<dir>/<day>/` with a safe name, never over another file. */
export async function saveDroppedFile(
  dropsDirectory: string,
  name: string,
  body: AsyncIterable<Buffer | string>,
  now: Date,
): Promise<string> {
  const day = join(dropsDirectory, dayOf(now))
  await mkdir(day, { recursive: true, mode: 0o700 })
  const { base, ext } = safeFileName(name)
  const { path, handle } = await openNewFile(day, base, ext, 1)
  let written = 0
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      written += chunk.length
      done(
        written > MAX_FILE_DROP_BYTES
          ? new FileDropTooLargeError(`Files up to ${MAX_FILE_DROP_BYTES / 1024 / 1024} MB.`)
          : null,
        chunk,
      )
    },
  })
  try {
    await pipeline(body, limit, handle.createWriteStream())
  } catch (error) {
    await rm(path, { force: true })
    throw error
  } finally {
    await handle.close().catch(() => undefined)
  }
  await pruneDrops(dropsDirectory, now)
  return path
}

async function openNewFile(
  day: string,
  base: string,
  ext: string,
  attempt: number,
): Promise<{ path: string; handle: FileHandle }> {
  const path = join(day, attempt === 1 ? `${base}${ext}` : `${base}-${attempt}${ext}`)
  try {
    return { path, handle: await open(path, 'wx', 0o600) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST' && attempt < 1000) {
      return await openNewFile(day, base, ext, attempt + 1)
    }
    throw error
  }
}

/** Keeps letters, digits, dots, dashes and underscores; everything else becomes `_`. */
export function safeFileName(name: string): { base: string; ext: string } {
  let clean = basename(name.replaceAll('\\', '/'))
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
  if (clean.length > 100) {
    clean = clean.slice(-100)
  }
  if (clean === '' || clean === '_') {
    clean = 'pasted'
  }
  const ext = extname(clean)
  return { base: clean.slice(0, clean.length - ext.length), ext }
}

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

async function pruneDrops(dropsDirectory: string, now: Date): Promise<void> {
  const oldest = now.getTime() - (KEEP_DROP_DAYS + 1) * 24 * 60 * 60 * 1000
  let days: string[]
  try {
    days = await readdir(dropsDirectory)
  } catch {
    return
  }
  await Promise.all(
    days
      .filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day) && Date.parse(`${day}T00:00:00Z`) < oldest)
      .map(day => rm(join(dropsDirectory, day), { recursive: true, force: true })),
  )
}

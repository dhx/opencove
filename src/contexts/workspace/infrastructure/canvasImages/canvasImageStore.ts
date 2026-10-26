import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { CANVAS_IMAGE_MIME_TYPES, type CanvasImageMimeType } from '../../../../shared/contracts/dto'

/**
 * Images pasted or dropped onto the canvas, kept as `<userData>/canvas-images/<assetId>`.
 *
 * The desktop app (Electron main) and the worker (for the Web UI) share this layout. Callers pass
 * an assetId that `normalize*CanvasImagePayload` has already validated; the path check here only
 * guards against a caller that did not.
 */

export const CANVAS_IMAGE_STORE_DIRECTORY_NAME = 'canvas-images'

export function resolveCanvasImageStoreDir(userDataPath: string): string {
  return resolve(userDataPath, CANVAS_IMAGE_STORE_DIRECTORY_NAME)
}

function resolveAssetPath(storeDir: string, assetId: string): string {
  const root = resolve(storeDir)
  const path = resolve(root, assetId)
  if (dirname(path) !== root) {
    throw new Error('Invalid canvas image asset path.')
  }
  return path
}

export async function writeCanvasImageFile(
  storeDir: string,
  assetId: string,
  bytes: Uint8Array,
): Promise<void> {
  const targetPath = resolveAssetPath(storeDir, assetId)
  await mkdir(dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.tmp-${crypto.randomUUID()}`
  try {
    await writeFile(tempPath, bytes)
    await rename(tempPath, targetPath)
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined)
  }
}

/** The stored bytes, or null when there is no such image. */
export async function readCanvasImageFile(
  storeDir: string,
  assetId: string,
): Promise<Buffer | null> {
  try {
    return await readFile(resolveAssetPath(storeDir, assetId))
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function deleteCanvasImageFile(storeDir: string, assetId: string): Promise<void> {
  await rm(resolveAssetPath(storeDir, assetId), { force: true })
}

/** The image type from the file's first bytes (the store keeps no type), or null. */
export function sniffCanvasImageMimeType(bytes: Uint8Array): CanvasImageMimeType | null {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)))
  let mimeType: CanvasImageMimeType | null = null
  if (bytes.length >= 8 && ascii(1, 4) === 'PNG' && bytes[0] === 0x89) {
    mimeType = 'image/png'
  } else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    mimeType = 'image/jpeg'
  } else if (ascii(0, 4) === 'GIF8') {
    mimeType = 'image/gif'
  } else if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    mimeType = 'image/webp'
  } else if (ascii(4, 8) === 'ftyp' && /^avi[fs]$/.test(ascii(8, 12))) {
    mimeType = 'image/avif'
  }
  return mimeType && CANVAS_IMAGE_MIME_TYPES.includes(mimeType) ? mimeType : null
}

import type {
  DeleteCanvasImageInput,
  ReadCanvasImageInput,
  ReadCanvasImageResult,
  WriteCanvasImageInput,
} from '@shared/contracts/dto'
import { getBrowserQueryToken } from './browserControlSurface'

/**
 * Canvas images in the Web UI: the worker keeps them as the desktop app does
 * (`<userData>/canvas-images/<assetId>`), reached through `/canvas-images/<assetId>`.
 */

function canvasImageUrl(assetId: string): string {
  return `/canvas-images/${encodeURIComponent(assetId)}`
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers = { ...extra }
  const token = getBrowserQueryToken()
  if (token) {
    headers.authorization = `Bearer ${token}`
  }
  return headers
}

async function failure(response: Response): Promise<Error> {
  const result = (await response.json().catch(() => null)) as { error?: unknown } | null
  return new Error(
    typeof result?.error === 'string' ? result.error : `The worker answered ${response.status}.`,
  )
}

export async function writeCanvasImageToWorker(payload: WriteCanvasImageInput): Promise<void> {
  const headers = authHeaders({
    'content-type': payload.mimeType,
    'x-opencove-drop': '1',
  })
  if (payload.fileName) {
    headers['x-file-name'] = encodeURIComponent(payload.fileName)
  }
  const response = await fetch(canvasImageUrl(payload.assetId), {
    method: 'PUT',
    credentials: 'same-origin',
    headers,
    body: new Blob([payload.bytes as Uint8Array<ArrayBuffer>], { type: payload.mimeType }),
  })
  if (!response.ok) {
    throw await failure(response)
  }
}

export async function readCanvasImageFromWorker(
  payload: ReadCanvasImageInput,
): Promise<ReadCanvasImageResult | null> {
  const response = await fetch(canvasImageUrl(payload.assetId), {
    method: 'GET',
    credentials: 'same-origin',
    headers: authHeaders(),
  })
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw await failure(response)
  }
  return { bytes: new Uint8Array(await response.arrayBuffer()) }
}

export async function deleteCanvasImageOnWorker(payload: DeleteCanvasImageInput): Promise<void> {
  const response = await fetch(canvasImageUrl(payload.assetId), {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: authHeaders({ 'x-opencove-drop': '1' }),
  })
  if (!response.ok) {
    throw await failure(response)
  }
}

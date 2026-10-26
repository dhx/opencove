import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteCanvasImageOnWorker,
  readCanvasImageFromWorker,
  writeCanvasImageToWorker,
} from '../../../src/app/renderer/browser/browserCanvasImages'

const assetId = '0b7c6a3e-5d1f-4c2a-9e8b-1a2b3c4d5e6f'

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('Canvas images in the Web UI', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes the bytes with their type, name and the custom header', async () => {
    const fetchMock = stubFetch(new Response('{"ok":true}', { status: 200 }))
    await writeCanvasImageToWorker({
      assetId,
      bytes: Uint8Array.from([1, 2, 3]),
      mimeType: 'image/png',
      fileName: 'shot 1.png',
    })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`/canvas-images/${assetId}`)
    expect(init?.method).toBe('PUT')
    expect(init?.credentials).toBe('same-origin')
    expect(init?.headers).toMatchObject({
      'content-type': 'image/png',
      'x-opencove-drop': '1',
      'x-file-name': 'shot%201.png',
    })
    expect(new Uint8Array(await (init!.body as Blob).arrayBuffer())).toEqual(
      Uint8Array.from([1, 2, 3]),
    )
  })

  it('reports the worker’s error', async () => {
    stubFetch(new Response('{"ok":false,"error":"Canvas image too large."}', { status: 413 }))
    await expect(
      writeCanvasImageToWorker({
        assetId,
        bytes: Uint8Array.from([1]),
        mimeType: 'image/png',
        fileName: null,
      }),
    ).rejects.toThrow('Canvas image too large.')
  })

  it('reads the bytes, and null for a missing image', async () => {
    stubFetch(new Response(Uint8Array.from([7, 8]), { status: 200 }))
    expect(await readCanvasImageFromWorker({ assetId })).toEqual({
      bytes: Uint8Array.from([7, 8]),
    })
    stubFetch(new Response('{"ok":false}', { status: 404 }))
    expect(await readCanvasImageFromWorker({ assetId })).toBeNull()
  })

  it('deletes with the custom header', async () => {
    const fetchMock = stubFetch(new Response('{"ok":true}', { status: 200 }))
    await deleteCanvasImageOnWorker({ assetId })
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'DELETE',
      headers: { 'x-opencove-drop': '1' },
    })
  })
})

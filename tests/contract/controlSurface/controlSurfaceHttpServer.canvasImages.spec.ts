// @vitest-environment node
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createControlSurfaceHttpRuntime } from '../../../src/app/main/controlSurface/controlSurfaceHttpRuntime'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { sniffCanvasImageMimeType } from '../../../src/contexts/workspace/infrastructure/canvasImages/canvasImageStore'
import { MAX_CANVAS_IMAGE_BYTES } from '../../../src/shared/contracts/dto'
import { createInMemoryPersistenceStore } from './controlSurfaceHttpServer.sessionStreaming.testUtils'

const TOKEN = 'canvas-images-secret'
const ASSET_ID = '0b7c6a3e-5d1f-4c2a-9e8b-1a2b3c4d5e6f'
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

describe('canvas image routes (Web UI)', () => {
  let root: string
  let origin: string
  let runtime: ReturnType<typeof createControlSurfaceHttpRuntime>

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'opencove-canvas-images-'))
    runtime = createControlSurfaceHttpRuntime({
      userDataPath: join(root, 'profile'),
      appVersion: '0.0.0',
      token: TOKEN,
      approvedWorkspaces: createApprovedWorkspaceStoreForPath(join(root, 'approved.json')),
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime: {
        spawnSession: async () => ({ sessionId: 'unused' }),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => () => undefined,
        onExit: () => () => undefined,
      },
    })
    await runtime.ready
    const listener = runtime.listen({
      hostname: '127.0.0.1',
      bindHostname: '127.0.0.1',
      port: 0,
      role: 'combined',
      enableWebShell: true,
      webUiPasswordHash: null,
    })
    origin = `http://127.0.0.1:${(await listener.ready).port}`
  })

  afterEach(async () => {
    await runtime.dispose()
    await rm(root, { recursive: true, force: true })
  })

  const request = (
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: Uint8Array | string },
  ) =>
    fetch(`${origin}${path}`, {
      method: init.method,
      headers: { authorization: `Bearer ${TOKEN}`, ...init.headers },
      body: init.body,
    })
  const put = (assetId: string, body: Uint8Array | string, headers: Record<string, string> = {}) =>
    request(`/canvas-images/${assetId}`, {
      method: 'PUT',
      headers: { 'x-opencove-drop': '1', 'content-type': 'image/png', ...headers },
      body,
    })

  it('stores, serves and deletes an image like the desktop store', async () => {
    const written = await put(ASSET_ID, PNG, { 'x-file-name': encodeURIComponent('shot 1.png') })
    expect(written.status).toBe(200)
    expect(await readFile(join(root, 'profile', 'canvas-images', ASSET_ID))).toEqual(
      Buffer.from(PNG),
    )

    const read = await request(`/canvas-images/${ASSET_ID}`, { method: 'GET' })
    expect(read.status).toBe(200)
    expect(read.headers.get('content-type')).toBe('image/png')
    expect(read.headers.get('cache-control')).toBe('private')
    expect(read.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(PNG)

    const deleted = await request(`/canvas-images/${ASSET_ID}`, {
      method: 'DELETE',
      headers: { 'x-opencove-drop': '1' },
    })
    expect(deleted.status).toBe(200)
    expect((await request(`/canvas-images/${ASSET_ID}`, { method: 'GET' })).status).toBe(404)
    // No temp files are left behind.
    expect(await readdir(join(root, 'profile', 'canvas-images'))).toEqual([])
  })

  it('requires auth, and the custom header for writes and deletes', async () => {
    const anonymous = await fetch(`${origin}/canvas-images/${ASSET_ID}`)
    expect(anonymous.status).toBe(401)
    const wrongToken = await fetch(`${origin}/canvas-images/${ASSET_ID}`, {
      headers: { authorization: 'Bearer nope' },
    })
    expect(wrongToken.status).toBe(401)
    expect((await put(ASSET_ID, PNG, { 'x-opencove-drop': '' })).status).toBe(401)
    expect((await request(`/canvas-images/${ASSET_ID}`, { method: 'DELETE' })).status).toBe(401)
    // A bearer token arriving with a foreign Origin was not sent by the Web UI.
    expect((await put(ASSET_ID, PNG, { origin: 'https://evil.example' })).status).toBe(401)
    expect((await request(`/canvas-images/${ASSET_ID}`, { method: 'GET' })).status).toBe(404)
  })

  it('refuses asset ids that are not UUIDs, including path traversal', async () => {
    for (const assetId of [
      '..%2F..%2Fapproved.json',
      '..%2Fcanvas-images%2Fx',
      encodeURIComponent(`${ASSET_ID}/../../approved.json`),
      `${ASSET_ID}.tmp`,
      'not-a-uuid',
      '',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const written = await put(assetId, PNG)
      expect(written.status, assetId).toBe(400)
      // eslint-disable-next-line no-await-in-loop
      const read = await request(`/canvas-images/${assetId}`, { method: 'GET' })
      expect(read.status, assetId).toBe(400)
    }
    await expect(readdir(join(root, 'profile', 'canvas-images'))).rejects.toThrow()
  })

  it('validates type, size and content like the desktop', async () => {
    expect((await put(ASSET_ID, PNG, { 'content-type': 'image/svg+xml' })).status).toBe(400)
    expect((await put(ASSET_ID, PNG, { 'content-type': 'text/html' })).status).toBe(400)
    expect((await put(ASSET_ID, '')).status).toBe(400)
    const tooLarge = await put(ASSET_ID, new Uint8Array(MAX_CANVAS_IMAGE_BYTES + 1))
    expect(tooLarge.status).toBe(413)
    expect((await request(`/canvas-images/${ASSET_ID}`, { method: 'GET' })).status).toBe(404)
  })

  it('types served images by their first bytes', () => {
    expect(sniffCanvasImageMimeType(PNG)).toBe('image/png')
    expect(sniffCanvasImageMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffCanvasImageMimeType(new TextEncoder().encode('GIF89a'))).toBe('image/gif')
    expect(sniffCanvasImageMimeType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe(
      'image/webp',
    )
    expect(sniffCanvasImageMimeType(new TextEncoder().encode('\0\0\0\x1cftypavif'))).toBe(
      'image/avif',
    )
    expect(sniffCanvasImageMimeType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull()
  })
})

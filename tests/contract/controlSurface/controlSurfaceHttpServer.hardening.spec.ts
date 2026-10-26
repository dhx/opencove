// @vitest-environment node

import { request as httpRequest } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import WebSocket from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerControlSurfaceHttpServer } from '../../../src/app/main/controlSurface/controlSurfaceHttpServer'
import type { RegisterControlSurfaceHttpServerOptions } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerOptions'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import {
  createInMemoryPersistenceStore,
  disposeAndCleanup,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

const TOKEN = 'test-token'
const PING = JSON.stringify({ kind: 'query', id: 'system.ping', payload: null })

async function withServer(
  overrides: Partial<RegisterControlSurfaceHttpServerOptions>,
  run: (baseUrl: string, port: number) => Promise<void>,
): Promise<void> {
  const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-hardening-'))
  const connectionFileName = 'control-surface.hardening.test.json'
  const server = registerControlSurfaceHttpServer({
    userDataPath,
    hostname: '127.0.0.1',
    port: 0,
    token: TOKEN,
    connectionFileName,
    approvedWorkspaces: createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    ),
    createPersistenceStore: async () => createInMemoryPersistenceStore(),
    ptyRuntime: {
      spawnSession: async () => ({ sessionId: 'test-session' }),
      write: () => undefined,
      resize: () => undefined,
      kill: () => undefined,
      onData: () => () => undefined,
      onExit: () => () => undefined,
    },
    enableWebShell: true,
    ...overrides,
  })

  const info = await server.ready
  const baseUrl = `http://${info.hostname}:${info.port}`
  try {
    await run(baseUrl, info.port)
  } finally {
    await disposeAndCleanup({
      server,
      userDataPath,
      connectionFilePath: resolve(userDataPath, connectionFileName),
      baseUrl,
    })
  }
}

async function postInvoke(
  baseUrl: string,
  headers: Record<string, string>,
  body = PING,
): Promise<Response> {
  return await fetch(`${baseUrl}/invoke`, { method: 'POST', headers, body })
}

async function openPtySocket(
  url: string,
  headers: Record<string, string>,
): Promise<'open' | 'rejected'> {
  const socket = new WebSocket(url, 'opencove-pty.v1', { headers })
  return await new Promise(resolvePromise => {
    socket.once('open', () => {
      socket.close()
      resolvePromise('open')
    })
    socket.once('error', () => resolvePromise('rejected'))
  })
}

/** GET the status line, then drop the connection (an SSE stream would otherwise stay open). */
function readStatusAndClose(url: string): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = httpRequest(url, res => {
      resolvePromise(res.statusCode ?? 0)
      req.destroy()
    })
    req.on('error', error => {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') {
        rejectPromise(error)
      }
    })
    req.end()
  })
}

function sendWithDeclaredLength(port: number, contentLength: number): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/invoke',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'content-length': String(contentLength),
        },
      },
      res => {
        resolvePromise(res.statusCode ?? 0)
        req.destroy()
      },
    )
    req.on('error', error => {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') {
        rejectPromise(error)
      }
    })
    // Send only the headers: the declared length alone must be refused.
    req.flushHeaders()
  })
}

describe('Control Surface HTTP server hardening', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('checks Origin for bearer requests on /invoke when a browser sends one', async () => {
    await withServer({}, async (baseUrl, port) => {
      const json = { 'content-type': 'application/json' }
      const bearer = { ...json, authorization: `Bearer ${TOKEN}` }

      expect((await postInvoke(baseUrl, bearer)).status).toBe(200)
      expect(
        (await postInvoke(baseUrl, { ...bearer, origin: `http://127.0.0.1:${port}` })).status,
      ).toBe(200)
      expect(
        (await postInvoke(baseUrl, { ...bearer, origin: 'https://evil.example' })).status,
      ).toBe(401)
    })
  })

  it('requires JSON and caps the /invoke body', async () => {
    await withServer({}, async (baseUrl, port) => {
      const unsupported = await postInvoke(baseUrl, {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'text/plain',
      })
      expect(unsupported.status).toBe(415)

      const formEncoded = await postInvoke(baseUrl, {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/x-www-form-urlencoded',
      })
      expect(formEncoded.status).toBe(415)

      const withCharset = await postInvoke(baseUrl, {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json; charset=utf-8',
      })
      expect(withCharset.status).toBe(200)

      expect(await sendWithDeclaredLength(port, 16 * 1024 * 1024 + 1)).toBe(413)
    })
  })

  it('refuses ?token= on /events and /pty unless explicitly allowed', async () => {
    await withServer({}, async (baseUrl, port) => {
      const events = await fetch(`${baseUrl}/events?token=${TOKEN}`)
      expect(events.status).toBe(401)
      await events.body?.cancel()
      expect(await openPtySocket(`ws://127.0.0.1:${port}/pty?token=${TOKEN}`, {})).toBe('rejected')
      expect(
        await openPtySocket(`ws://127.0.0.1:${port}/pty`, { authorization: `Bearer ${TOKEN}` }),
      ).toBe('open')
    })

    await withServer({ allowQueryToken: true }, async (baseUrl, port) => {
      expect(await readStatusAndClose(`${baseUrl}/events?token=${TOKEN}`)).toBe(200)

      expect(await openPtySocket(`ws://127.0.0.1:${port}/pty?token=${TOKEN}`, {})).toBe('open')
    })
  })

  it('checks Origin for bearer /events and /pty requests', async () => {
    await withServer({}, async (baseUrl, port) => {
      const events = await fetch(`${baseUrl}/events`, {
        headers: { authorization: `Bearer ${TOKEN}`, origin: 'https://evil.example' },
      })
      expect(events.status).toBe(401)
      await events.body?.cancel()

      expect(
        await openPtySocket(`ws://127.0.0.1:${port}/pty`, {
          authorization: `Bearer ${TOKEN}`,
          origin: 'https://evil.example',
        }),
      ).toBe('rejected')
      expect(
        await openPtySocket(`ws://127.0.0.1:${port}/pty`, {
          authorization: `Bearer ${TOKEN}`,
          origin: `http://127.0.0.1:${port}`,
        }),
      ).toBe('open')
    })
  })

  it('serves /debug/shell only when debug routes are enabled', async () => {
    await withServer({}, async baseUrl => {
      const res = await fetch(`${baseUrl}/debug/shell`)
      expect(res.status).toBe(404)
      await res.body?.cancel()
    })

    await withServer({ enableDebugRoutes: true }, async baseUrl => {
      const res = await fetch(`${baseUrl}/debug/shell`)
      expect(res.status).toBe(200)
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN')
      await res.body?.cancel()
    })
  })

  it('sends frame and sniffing protection headers on Web UI HTML', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5173')
    await withServer({}, async baseUrl => {
      const res = await fetch(`${baseUrl}/`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/html')
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'self'")
      await res.body?.cancel()
    })
  })
})

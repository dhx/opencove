// @vitest-environment node

import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { resolveRequestAuth } from '../../../src/app/main/controlSurface/http/requestAuth'
import { WebSessionManager } from '../../../src/app/main/controlSurface/http/webSessionManager'

function createCookieHeader(webSessions: WebSessionManager): string {
  const issued = webSessions.issueTicket(new Date('2026-04-01T00:00:00.000Z'), '/')
  const claimed = webSessions.claimTicket(new Date('2026-04-01T00:00:01.000Z'), issued.ticket)
  if (!claimed) {
    throw new Error('Failed to claim test web session ticket')
  }

  return `${webSessions.cookieName()}=${claimed.cookieValue}`
}

function createRequest(headers: Record<string, string | undefined>): IncomingMessage {
  return { headers } as IncomingMessage
}

describe('resolveRequestAuth', () => {
  it('keeps independent Worker profile logins usable in the same browser cookie jar', () => {
    const primary = new WebSessionManager('/profiles/primary')
    const development = new WebSessionManager('/profiles/development')
    const jar = new Map<string, string>()
    for (const sessions of [primary, development]) {
      const pair = createCookieHeader(sessions)
      jar.set(sessions.cookieName(), pair)
    }
    expect(jar.size).toBe(2)
    expect(new WebSessionManager('/profiles/primary').cookieName()).toBe(primary.cookieName())
    const authenticate = (webSessions: WebSessionManager) =>
      resolveRequestAuth({
        req: createRequest({
          cookie: [...jar.values()].join('; '),
          host: '127.0.0.1:8080',
          origin: 'http://127.0.0.1:8080',
        }),
        url: new URL('http://127.0.0.1:8080/invoke'),
        token: 'test-token',
        webSessions,
        allowQueryToken: false,
        now: new Date('2026-04-01T00:00:02.000Z'),
      })
    expect(authenticate(primary)).toEqual({ kind: 'cookie', webSessionGeneration: 0 })
    expect(authenticate(development)).toEqual({ kind: 'cookie', webSessionGeneration: 0 })
    development.invalidateAll()
    expect(authenticate(development)).toBeNull()
    expect(authenticate(primary)).toEqual({ kind: 'cookie', webSessionGeneration: 0 })
    jar.delete(development.cookieName())
    expect(authenticate(primary)).toEqual({ kind: 'cookie', webSessionGeneration: 0 })
  })

  it('accepts bearer tokens', () => {
    const webSessions = new WebSessionManager()
    const auth = resolveRequestAuth({
      req: createRequest({
        authorization: 'Bearer test-token',
        host: '127.0.0.1:8080',
      }),
      url: new URL('http://127.0.0.1:8080/invoke'),
      token: 'test-token',
      webSessions,
      allowQueryToken: false,
      now: new Date('2026-04-01T00:00:00.000Z'),
    })

    expect(auth).toEqual({ kind: 'bearer' })
  })

  it('accepts cookie auth for same-origin requests without an Origin header', () => {
    const webSessions = new WebSessionManager()
    const auth = resolveRequestAuth({
      req: createRequest({
        cookie: createCookieHeader(webSessions),
        host: '127.0.0.1:8080',
        referer: 'http://127.0.0.1:8080/',
      }),
      url: new URL('http://127.0.0.1:8080/events'),
      token: 'test-token',
      webSessions,
      allowQueryToken: false,
      now: new Date('2026-04-01T00:00:02.000Z'),
    })

    expect(auth).toEqual({ kind: 'cookie', webSessionGeneration: 0 })
  })

  it('accepts cookie auth for same-origin browser fetch metadata requests', () => {
    const webSessions = new WebSessionManager()
    const auth = resolveRequestAuth({
      req: createRequest({
        cookie: createCookieHeader(webSessions),
        host: '127.0.0.1:8080',
        'sec-fetch-site': 'same-origin',
      }),
      url: new URL('http://127.0.0.1:8080/events'),
      token: 'test-token',
      webSessions,
      allowQueryToken: false,
      now: new Date('2026-04-01T00:00:02.000Z'),
    })

    expect(auth).toEqual({ kind: 'cookie', webSessionGeneration: 0 })
  })

  it('invalidates old cookies when the Web auth generation rotates', () => {
    const webSessions = new WebSessionManager()
    const cookie = createCookieHeader(webSessions)

    expect(webSessions.invalidateAll()).toEqual({ previousGeneration: 0, generation: 1 })

    const auth = resolveRequestAuth({
      req: createRequest({
        cookie,
        host: '127.0.0.1:8080',
        'sec-fetch-site': 'same-origin',
      }),
      url: new URL('http://127.0.0.1:8080/events'),
      token: 'test-token',
      webSessions,
      allowQueryToken: false,
      now: new Date('2026-04-01T00:00:02.000Z'),
    })

    expect(auth).toBeNull()
  })

  it('rejects cookie auth for cross-origin requests', () => {
    const webSessions = new WebSessionManager()
    const auth = resolveRequestAuth({
      req: createRequest({
        cookie: createCookieHeader(webSessions),
        host: '127.0.0.1:8080',
        origin: 'http://evil.example',
      }),
      url: new URL('http://127.0.0.1:8080/events'),
      token: 'test-token',
      webSessions,
      allowQueryToken: false,
      now: new Date('2026-04-01T00:00:02.000Z'),
    })

    expect(auth).toBeNull()
  })
  function resolveTokenAuth(
    headers: Record<string, string | undefined>,
    options: { url?: string; allowQueryToken?: boolean } = {},
  ) {
    return resolveRequestAuth({
      req: createRequest(headers),
      url: new URL(options.url ?? 'http://127.0.0.1:8080/invoke'),
      token: 'test-token',
      webSessions: new WebSessionManager(),
      allowQueryToken: options.allowQueryToken ?? false,
      now: new Date('2026-04-01T00:00:00.000Z'),
    })
  }

  it('accepts bearer tokens whose Origin matches the Host header', () => {
    expect(
      resolveTokenAuth({
        authorization: 'Bearer test-token',
        host: 'opencove.example.test',
        origin: 'https://opencove.example.test',
      }),
    ).toEqual({ kind: 'bearer' })
  })

  it('rejects bearer tokens that arrive with a foreign Origin', () => {
    expect(
      resolveTokenAuth({
        authorization: 'Bearer test-token',
        host: 'opencove.example.test',
        origin: 'https://evil.example',
      }),
    ).toBeNull()
    expect(
      resolveTokenAuth({
        authorization: 'Bearer test-token',
        host: '127.0.0.1:8080',
        origin: 'null',
      }),
    ).toBeNull()
  })

  it('ignores the query token unless explicitly allowed', () => {
    const headers = { host: '127.0.0.1:8080' }
    const url = 'http://127.0.0.1:8080/events?token=test-token'
    expect(resolveTokenAuth(headers, { url })).toBeNull()
    expect(resolveTokenAuth(headers, { url, allowQueryToken: true })).toEqual({
      kind: 'query_token',
    })
    expect(
      resolveTokenAuth(
        { ...headers, origin: 'http://evil.example' },
        { url, allowQueryToken: true },
      ),
    ).toBeNull()
  })
})

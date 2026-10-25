// @vitest-environment node

import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { tryHandleWebAuthRoutes } from '../../../src/app/main/controlSurface/http/webAuthRoutes'
import {
  buildWebSessionClearCookieHeader,
  buildWebSessionCookieHeader,
  WebSessionManager,
} from '../../../src/app/main/controlSurface/http/webSessionManager'
import {
  isSecureRequest,
  resolveClientAddress,
} from '../../../src/app/main/controlSurface/http/requestTransport'

function loginRequest(
  body: string,
  options: {
    remoteAddress?: string
    encrypted?: boolean
    headers?: Record<string, string>
  } = {},
) {
  const request = Readable.from([body]) as Readable & {
    method: string
    socket: { remoteAddress: string; encrypted?: boolean }
    headers: Record<string, string>
  }
  request.method = 'POST'
  request.socket = {
    remoteAddress: options.remoteAddress ?? '127.0.0.1',
    ...(options.encrypted ? { encrypted: true } : {}),
  }
  request.headers = options.headers ?? {}
  return request
}

function createResponse() {
  const headers = new Map<string, unknown>()
  return {
    headers,
    response: {
      statusCode: 0,
      setHeader: vi.fn((name: string, value: unknown) => headers.set(name.toLowerCase(), value)),
      end: vi.fn(),
    },
  }
}

async function login(request: ReturnType<typeof loginRequest>) {
  const { headers, response } = createResponse()
  await tryHandleWebAuthRoutes({
    req: request as never,
    res: response as never,
    url: new URL('http://localhost/auth/login'),
    now: () => new Date('2026-09-01T00:00:00.000Z'),
    webSessions: new WebSessionManager(),
    webUiPasswordHash: 'hash',
    verifyPassword: async password => password === 'right',
  })
  return { status: response.statusCode, headers }
}

describe('Web auth routes', () => {
  it('does not issue a session from password verification started before policy rotation', async () => {
    let resolveVerification!: (valid: boolean) => void
    let markVerificationStarted!: () => void
    const verificationStarted = new Promise<void>(resolve => {
      markVerificationStarted = resolve
    })
    let authRevisionCurrent = true
    const headers = new Map<string, unknown>()
    const response = {
      statusCode: 0,
      setHeader: vi.fn((name: string, value: unknown) => headers.set(name.toLowerCase(), value)),
      end: vi.fn(),
    }

    const operation = tryHandleWebAuthRoutes({
      req: loginRequest('password=old-password') as never,
      res: response as never,
      url: new URL('http://localhost/auth/login'),
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      webSessions: new WebSessionManager(),
      webUiPasswordHash: 'old-hash',
      isWebUiAuthRevisionCurrent: () => authRevisionCurrent,
      verifyPassword: async () => {
        markVerificationStarted()
        return await new Promise<boolean>(resolve => {
          resolveVerification = resolve
        })
      },
    })

    await verificationStarted
    authRevisionCurrent = false
    resolveVerification(true)
    await expect(operation).resolves.toBe(true)

    expect(response.statusCode).toBe(401)
    expect(headers.has('set-cookie')).toBe(false)
  })

  it('marks the session cookie Secure only when the browser connection used TLS', async () => {
    const plain = await login(loginRequest('password=right'))
    expect(plain.status).toBe(302)
    expect(String(plain.headers.get('set-cookie'))).not.toContain('Secure')

    const proxied = await login(
      loginRequest('password=right', { headers: { 'x-forwarded-proto': 'https' } }),
    )
    expect(String(proxied.headers.get('set-cookie'))).toMatch(/; Secure$/)

    const direct = await login(
      loginRequest('password=right', { remoteAddress: '10.0.0.5', encrypted: true }),
    )
    expect(String(direct.headers.get('set-cookie'))).toMatch(/; Secure$/)

    // A remote peer cannot claim TLS through a forwarded header.
    const spoofed = await login(
      loginRequest('password=right', {
        remoteAddress: '10.0.0.5',
        headers: { 'x-forwarded-proto': 'https' },
      }),
    )
    expect(String(spoofed.headers.get('set-cookie'))).not.toContain('Secure')
  })

  it('sends frame protection headers on the login page', async () => {
    const failed = await login(loginRequest('password=wrong', { remoteAddress: '10.9.9.9' }))
    expect(failed.status).toBe(401)
    expect(failed.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(failed.headers.get('content-security-policy')).toBe("frame-ancestors 'self'")
    expect(failed.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('rate-limits failed logins per forwarded client behind a loopback proxy', async () => {
    const attempt = async (clientAddress: string) =>
      await login(
        loginRequest('password=wrong', {
          headers: { 'x-forwarded-for': `203.0.113.250, ${clientAddress}` },
        }),
      )

    const failures = await Promise.all(
      Array.from({ length: 8 }, async () => (await attempt('198.51.100.7')).status),
    )
    expect(failures).toEqual(Array.from({ length: 8 }, () => 401))
    expect((await attempt('198.51.100.7')).status).toBe(429)
    // Another client behind the same proxy is not locked out.
    expect((await attempt('198.51.100.8')).status).toBe(401)
  })

  it('builds Secure cookies on request', () => {
    expect(
      buildWebSessionCookieHeader({ cookieName: 'c', cookieValue: 'v', maxAgeSeconds: 1 }),
    ).toBe('c=v; HttpOnly; SameSite=Strict; Path=/; Max-Age=1')
    expect(
      buildWebSessionCookieHeader({
        cookieName: 'c',
        cookieValue: 'v',
        maxAgeSeconds: 1,
        secure: true,
      }),
    ).toBe('c=v; HttpOnly; SameSite=Strict; Path=/; Max-Age=1; Secure')
    expect(buildWebSessionClearCookieHeader({ cookieName: 'c', secure: true })).toContain(
      '; Secure',
    )
  })

  it('trusts forwarded headers only from a loopback peer', () => {
    const request = (remoteAddress: string, headers: Record<string, string>) =>
      ({ socket: { remoteAddress }, headers }) as never
    expect(isSecureRequest(request('::1', { 'x-forwarded-proto': 'https' }))).toBe(true)
    expect(isSecureRequest(request('127.0.0.1', { 'x-forwarded-proto': 'http' }))).toBe(false)
    expect(resolveClientAddress(request('127.0.0.1', {}))).toBe('127.0.0.1')
    expect(resolveClientAddress(request('127.0.0.1', { 'x-forwarded-for': 'a, b' }))).toBe(
      'forwarded:b',
    )
    expect(resolveClientAddress(request('10.0.0.1', { 'x-forwarded-for': 'a' }))).toBe('10.0.0.1')
  })
})

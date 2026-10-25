import type { IncomingMessage } from 'node:http'

function firstHeaderValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') {
    return null
  }

  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function isLoopbackAddress(value: string | null | undefined): boolean {
  if (!value) {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return (
    normalized === '::1' ||
    normalized === 'localhost' ||
    normalized.startsWith('127.') ||
    normalized.startsWith('::ffff:127.')
  )
}

/** Forwarded headers are only trusted from a reverse proxy on the same host. */
export function isLoopbackPeer(req: IncomingMessage): boolean {
  return isLoopbackAddress(req.socket?.remoteAddress ?? null)
}

/**
 * True when the browser reached us over TLS: either this socket is TLS, or a reverse proxy on
 * loopback terminated TLS and says so with `X-Forwarded-Proto: https`.
 */
export function isSecureRequest(req: IncomingMessage): boolean {
  if ((req.socket as { encrypted?: boolean } | undefined)?.encrypted === true) {
    return true
  }

  if (!isLoopbackPeer(req)) {
    return false
  }

  const forwardedProto = firstHeaderValue(req.headers?.['x-forwarded-proto'])
  const firstProto = forwardedProto?.split(',')[0]?.trim().toLowerCase() ?? null
  return firstProto === 'https'
}

/**
 * The client address for rate limiting. Behind a loopback reverse proxy every request shares the
 * proxy's address, so use the address the proxy appended last to `X-Forwarded-For` (entries before
 * it are supplied by the client and cannot be trusted).
 */
export function resolveClientAddress(req: IncomingMessage): string {
  const socketAddress = req.socket?.remoteAddress?.trim() || 'unknown'
  if (!isLoopbackPeer(req)) {
    return socketAddress
  }

  const forwardedFor = firstHeaderValue(req.headers?.['x-forwarded-for'])
  const lastHop = forwardedFor
    ?.split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
    .pop()
  return lastHop ? `forwarded:${lastHop}` : socketAddress
}

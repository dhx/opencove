const ALLOWED_WEBSITE_PROTOCOLS = new Set(['http:', 'https:'])
const LIKELY_HOST_PATTERN =
  /^(localhost|(\d{1,3}\.){3}\d{1,3}|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(?::\d{1,5})?(?:[/?#][^\s]*)?$/i

export function resolveWebsiteNavigationUrl(rawUrl: string): {
  url: string | null
  error: string | null
} {
  const trimmed = rawUrl.trim()
  if (trimmed.length === 0) {
    return { url: null, error: null }
  }

  try {
    const parsed = new URL(trimmed)
    if (!ALLOWED_WEBSITE_PROTOCOLS.has(parsed.protocol)) {
      return { url: null, error: `Unsupported protocol: ${parsed.protocol}` }
    }

    return { url: parsed.toString(), error: null }
  } catch {
    try {
      const parsed = new URL(`https://${trimmed}`)
      return { url: parsed.toString(), error: null }
    } catch {
      return { url: null, error: 'Invalid URL' }
    }
  }
}

export function isWebsiteUrlAllowedForNavigation(rawUrl: string): boolean {
  const resolved = resolveWebsiteNavigationUrl(rawUrl)
  return resolved.url !== null && resolved.error === null
}

export function resolveWebsitePasteUrl(rawUrl: string): {
  url: string | null
  error: string | null
} {
  const trimmed = rawUrl.trim()
  if (trimmed.length === 0) {
    return { url: null, error: null }
  }

  if (/\s/.test(trimmed)) {
    return { url: null, error: 'Invalid URL' }
  }

  const normalizedLowercase = trimmed.toLowerCase()
  if (normalizedLowercase.startsWith('http://') || normalizedLowercase.startsWith('https://')) {
    return resolveWebsiteNavigationUrl(trimmed)
  }

  if (!LIKELY_HOST_PATTERN.test(trimmed)) {
    return { url: null, error: 'Invalid URL' }
  }

  return resolveWebsiteNavigationUrl(`https://${trimmed}`)
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '[::1]', '0.0.0.0', '[::]'])

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return LOOPBACK_HOSTNAMES.has(host) || host.endsWith('.localhost') || /^127\./.test(host)
}

function effectivePort(url: URL): string {
  return url.port || (url.protocol === 'https:' ? '443' : '80')
}

/**
 * A website node must not show the app itself: an embedded page on the app's host would share its
 * cookies (cookies are per host, not per port or scheme) and, being same-origin, could script the app.
 * Refused: any URL on the app page's hostname, and loopback URLs on the app's port (the worker itself,
 * reached under another loopback name). Only applies when the app is served over http(s).
 */
export function isWebsiteUrlOnAppOrigin(rawUrl: string, appUrl: string): boolean {
  let target: URL
  let app: URL
  try {
    target = new URL(rawUrl)
    app = new URL(appUrl)
  } catch {
    return false
  }
  if (
    !ALLOWED_WEBSITE_PROTOCOLS.has(app.protocol) ||
    !ALLOWED_WEBSITE_PROTOCOLS.has(target.protocol)
  ) {
    return false
  }
  if (target.hostname.toLowerCase() === app.hostname.toLowerCase()) {
    return true
  }
  return isLoopbackHostname(target.hostname) && effectivePort(target) === effectivePort(app)
}

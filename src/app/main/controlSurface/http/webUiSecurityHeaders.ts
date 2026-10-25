import type { ServerResponse } from 'node:http'

/**
 * Headers for every HTML document the Web UI serves (the app shell, the login page, the debug
 * shell). Plugin views are same-origin frames inside the Web UI, so framing by 'self' must keep
 * working; everything else may not frame the UI.
 */
export function applyWebUiHtmlSecurityHeaders(res: ServerResponse): void {
  res.setHeader('x-frame-options', 'SAMEORIGIN')
  res.setHeader('content-security-policy', "frame-ancestors 'self'")
  res.setHeader('x-content-type-options', 'nosniff')
}

/** Headers for non-HTML Web UI assets (scripts, styles, images). */
export function applyWebUiAssetSecurityHeaders(res: ServerResponse): void {
  res.setHeader('x-content-type-options', 'nosniff')
}

export function isHtmlContentType(contentType: string): boolean {
  return contentType.split(';')[0]?.trim().toLowerCase() === 'text/html'
}

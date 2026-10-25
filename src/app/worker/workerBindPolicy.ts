function normalizeBindHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase()
  return trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed
}

export function isLoopbackBindHostname(hostname: string): boolean {
  const normalized = normalizeBindHostname(hostname)
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized.startsWith('127.') ||
    normalized.startsWith('::ffff:127.')
  )
}

/**
 * A Worker reachable from other machines must have a Web UI password, or the operator must say
 * explicitly (`--allow-insecure-bind`) that something else protects it (a VPN, a gate in front).
 * Returns an error message, or null when the bind is allowed.
 */
export function resolveWorkerBindRefusal(options: {
  bindHostname: string
  webUiPasswordConfigured: boolean
  allowInsecureBind: boolean
}): string | null {
  if (isLoopbackBindHostname(options.bindHostname)) {
    return null
  }
  if (options.webUiPasswordConfigured || options.allowInsecureBind) {
    return null
  }

  return (
    `[worker] refusing to listen on ${options.bindHostname} without a Web UI password. ` +
    'Set --web-ui-password-file (or OPENCOVE_WEB_UI_PASSWORD), bind to 127.0.0.1, ' +
    'or pass --allow-insecure-bind if another layer protects this address.'
  )
}

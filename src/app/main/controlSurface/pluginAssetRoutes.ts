import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PluginInstallationManager } from '../../../contexts/plugins/application/PluginInstallationManager'
import { PLUGIN_BRIDGE_SCRIPT } from '../../../contexts/plugins/infrastructure/pluginBridgeScript'

const HOST_SOURCE = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/

function firstHeader(value: string | string[] | undefined): string | null {
  const first = (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim()
  return first && HOST_SOURCE.test(first) ? first : null
}

/**
 * Policy for every plugin asset. `sandbox` puts any plugin document into an opaque origin wherever it is
 * opened (the plugin view iframe, a website window, a top-level tab), so plugin script never runs with
 * the Web UI's origin. Views reach only their own files and inline data, not arbitrary hosts.
 *
 * Sources name the asset host explicitly besides 'self': WebKit matches 'self' against the document's
 * (opaque) origin in a sandboxed document, so 'self' alone allows nothing there. The host is the one
 * the browser asked for (Host, or X-Forwarded-Host behind a proxy), under either scheme.
 */
export function pluginAssetContentSecurityPolicy(req: Pick<IncomingMessage, 'headers'>): string {
  const hosts = [
    ...new Set(
      [firstHeader(req.headers['x-forwarded-host']), firstHeader(req.headers.host)].filter(
        (host): host is string => host !== null,
      ),
    ),
  ]
  const own = ["'self'", ...hosts.flatMap(host => [`http://${host}`, `https://${host}`])]
  const sockets = hosts.flatMap(host => [`ws://${host}`, `wss://${host}`])
  const list = (...sources: string[]) => sources.join(' ')
  return [
    `default-src ${list(...own)}`,
    `script-src ${list(...own)}`,
    `style-src ${list(...own)}`,
    `img-src ${list(...own, 'data:', 'blob:')}`,
    `media-src ${list(...own, 'blob:')}`,
    `connect-src ${list(...own, ...sockets)}`,
    `font-src ${list(...own, 'data:')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    'sandbox allow-scripts allow-popups allow-downloads allow-forms',
  ].join('; ')
}

export async function tryHandlePluginAssetRoute(input: {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  plugins: PluginInstallationManager
}): Promise<boolean> {
  if (
    !input.url.pathname.startsWith('/plugin-assets/') &&
    !input.req.url?.startsWith('/plugin-assets/')
  ) {
    return false
  }
  const { req, res, url, plugins } = input
  const [, , token, ...parts] = url.pathname.split('/')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('content-security-policy', pluginAssetContentSecurityPolicy(req))
  if (!url.pathname.startsWith('/plugin-assets/') || !token || !plugins.hasResourceToken(token)) {
    res.statusCode = 404
    res.end()
    return true
  }
  try {
    const path = parts.map(decodeURIComponent).join('/')
    if (path === '__close' && req.method === 'POST') {
      await plugins.closeViewToken(token)
      res.statusCode = 204
      res.end()
      return true
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 404
      res.end()
      return true
    }
    if (!path) {
      res.statusCode = 404
      res.end()
      return true
    }
    if (path === '__opencove_bridge.js') {
      res.setHeader('content-type', 'text/javascript; charset=utf-8')
      res.end(req.method === 'HEAD' ? undefined : PLUGIN_BRIDGE_SCRIPT)
      return true
    }
    const resource = await plugins.resource(token, path)
    if (!resource) {
      res.statusCode = 404
      res.end()
      return true
    }
    res.setHeader('content-type', resource.contentType)
    // Views run in a sandboxed frame with an opaque origin, so their module scripts, fonts and fetches of
    // their own files are cross-origin (CORS) requests. Without credentials: the token is the capability.
    res.setHeader('access-control-allow-origin', '*')
    let body = Buffer.from(resource.body)
    if (resource.contentType.startsWith('text/html')) {
      const bridge = `<script src="/plugin-assets/${token}/__opencove_bridge.js"></script>`
      const html = body.toString('utf8')
      body = Buffer.from(
        /<head(?:\s[^>]*)?>/i.test(html)
          ? html.replace(/<head(?:\s[^>]*)?>/i, head => `${head}${bridge}`)
          : `${bridge}${html}`,
      )
    }
    res.setHeader('content-length', body.length)
    res.statusCode = 200
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch {
    res.statusCode = 404
    res.end()
  }
  return true
}

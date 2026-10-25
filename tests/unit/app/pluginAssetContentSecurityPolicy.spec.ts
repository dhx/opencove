// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { pluginAssetContentSecurityPolicy } from '../../../src/app/main/controlSurface/pluginAssetRoutes'

describe('plugin asset content security policy', () => {
  it('names the requested host and the proxy host explicitly, under both schemes', () => {
    const csp = pluginAssetContentSecurityPolicy({
      headers: { host: '127.0.0.1:3200', 'x-forwarded-host': 'cove.example.test, other.test' },
    })
    expect(csp).toContain(
      "script-src 'self' http://cove.example.test https://cove.example.test http://127.0.0.1:3200 https://127.0.0.1:3200;",
    )
    expect(csp).toContain('wss://cove.example.test')
    expect(csp).not.toContain('other.test')
    expect(csp).toMatch(/; sandbox allow-scripts allow-popups allow-downloads allow-forms$/)
  })

  it('ignores host values that could inject sources or directives', () => {
    const csp = pluginAssetContentSecurityPolicy({
      headers: { host: "evil.test; script-src 'unsafe-inline'", 'x-forwarded-host': '* data:' },
    })
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('evil.test')
    expect(csp).toContain("script-src 'self';")
  })
})

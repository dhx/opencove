import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserPtyClient } from '../../../src/app/renderer/browser/BrowserPtyClient'
import type { BrowserPtySocketLease } from '../../../src/app/renderer/browser/BrowserPtySocketLifecycle'

type ClientInternals = {
  handleMessage: (lease: BrowserPtySocketLease, raw: string) => Promise<void>
}

describe('BrowserPtyClient foreground events', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes the worker foreground reconciliation events to listeners', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'http:', host: 'localhost:3000', search: '' },
      clearTimeout,
      setTimeout,
    })
    const client = new BrowserPtyClient()
    const internals = client as unknown as ClientInternals
    const lease: BrowserPtySocketLease = Object.freeze({})
    const listener = vi.fn()
    const unsubscribe = client.onForeground(listener)

    const shellBack = {
      sessionId: 'session-1',
      observedAtMs: 1_000,
      source: 'process_scan',
      exitCode: null,
      availability: 'available',
      agent: null,
      shellOnly: true,
    }
    await internals.handleMessage(lease, JSON.stringify({ type: 'foreground', ...shellBack }))
    // Malformed events are dropped, as the desktop client drops them.
    await internals.handleMessage(
      lease,
      JSON.stringify({ type: 'foreground', sessionId: 'session-1', shellOnly: 'yes' }),
    )

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(shellBack)

    unsubscribe()
    await internals.handleMessage(lease, JSON.stringify({ type: 'foreground', ...shellBack }))
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

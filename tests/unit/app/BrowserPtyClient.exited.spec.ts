import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserPtyClient } from '../../../src/app/renderer/browser/BrowserPtyClient'
import type { BrowserPtySocketLease } from '../../../src/app/renderer/browser/BrowserPtySocketLifecycle'

type ClientInternals = {
  handleMessage: (lease: BrowserPtySocketLease, raw: string) => Promise<void>
  attachedSessions: Map<string, { lastSeq: number; role: string; authorityEpoch: number | null }>
  socketLifecycle: {
    ensureReady: () => Promise<BrowserPtySocketLease>
    sendIfCurrent: (lease: BrowserPtySocketLease, payload: unknown) => boolean
    options: { onDisconnected: (lease: BrowserPtySocketLease, error: Error) => void }
  }
}

function installWindow(): void {
  vi.stubGlobal('window', {
    location: { protocol: 'http:', host: 'localhost:3000', search: '' },
    clearTimeout,
    setTimeout,
  })
}

function createLease(): BrowserPtySocketLease {
  return Object.freeze({})
}

function getInternals(client: BrowserPtyClient): ClientInternals {
  return client as unknown as ClientInternals
}

function prepareSocket(internals: ClientInternals, lease: BrowserPtySocketLease) {
  vi.spyOn(internals.socketLifecycle, 'ensureReady').mockResolvedValue(lease)
  return vi.spyOn(internals.socketLifecycle, 'sendIfCurrent').mockReturnValue(true)
}

async function attachClient(options: {
  client: BrowserPtyClient
  internals: ClientInternals
  lease: BrowserPtySocketLease
  sessionId: string
  role?: 'viewer' | 'controller'
  authorityEpoch?: number
  capabilities?: Record<string, number>
}) {
  await options.internals.handleMessage(
    options.lease,
    JSON.stringify({
      type: 'hello_ack',
      capabilities: options.capabilities ?? { geometryCommitAck: 1 },
    }),
  )
  const pending = options.client.attach({ sessionId: options.sessionId })
  await vi.waitFor(() => {
    expect(options.internals.socketLifecycle.sendIfCurrent).toHaveBeenCalledWith(
      options.lease,
      expect.objectContaining({ type: 'attach', sessionId: options.sessionId }),
    )
  })
  await options.internals.handleMessage(
    options.lease,
    JSON.stringify({
      type: 'attached',
      sessionId: options.sessionId,
      role: options.role ?? 'controller',
      authorityEpoch: options.authorityEpoch ?? 1,
    }),
  )
  return await pending
}

// After a session exits, nothing but an explicit attach may attach to it again: an implicit one
// (a write, e.g. a mouse report, or a resize) had no seq to resume from, so the hub replayed the
// session's whole retained output and its exit, and the terminal flickered on every pointer move.
describe('BrowserPtyClient after a session exited', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not attach to an exited session again when it is written to or resized', async () => {
    installWindow()
    const client = new BrowserPtyClient()
    const internals = getInternals(client)
    const lease = createLease()
    const send = prepareSocket(internals, lease)
    await attachClient({ client, internals, lease, sessionId: 'session-exited' })
    await internals.handleMessage(
      lease,
      JSON.stringify({ type: 'data', sessionId: 'session-exited', seq: 500, data: 'x' }),
    )
    await internals.handleMessage(
      lease,
      JSON.stringify({ type: 'exit', sessionId: 'session-exited', seq: 501, exitCode: 1 }),
    )
    send.mockClear()

    // A mouse report that a TUI left switched on, sent while the pointer moves over the terminal.
    await client.write({ sessionId: 'session-exited', data: '\u001b[<35;10;5M' })
    const resized = await client.resize({
      sessionId: 'session-exited',
      cols: 80,
      rows: 24,
      operationId: 'resize-after-exit',
    })
    const reexec = await client.reexecAgent({
      sessionId: 'session-exited',
      provider: 'claude-code',
      resumeSessionId: null,
      expectedActivity: null,
    } as Parameters<BrowserPtyClient['reexecAgent']>[0])

    expect(send).not.toHaveBeenCalled()
    expect(resized).toMatchObject({
      sessionId: 'session-exited',
      operationId: 'resize-after-exit',
      status: 'session_not_found',
      changed: false,
    })
    expect(reexec.status).toBe('session_not_found')
  })

  it('attaches to an exited session again when asked to explicitly', async () => {
    installWindow()
    const client = new BrowserPtyClient()
    const internals = getInternals(client)
    const lease = createLease()
    const send = prepareSocket(internals, lease)
    await attachClient({ client, internals, lease, sessionId: 'session-exited' })
    await internals.handleMessage(
      lease,
      JSON.stringify({ type: 'exit', sessionId: 'session-exited', seq: 10, exitCode: 0 }),
    )
    send.mockClear()

    const pending = client.attach({ sessionId: 'session-exited', afterSeq: 10 })
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        lease,
        expect.objectContaining({ type: 'attach', sessionId: 'session-exited', afterSeq: 10 }),
      )
    })
    await internals.handleMessage(
      lease,
      JSON.stringify({
        type: 'attached',
        sessionId: 'session-exited',
        role: 'controller',
        authorityEpoch: 2,
      }),
    )
    await pending
    send.mockClear()
    await client.write({ sessionId: 'session-exited', data: 'a' })
    expect(send).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({ type: 'write', sessionId: 'session-exited', data: 'a' }),
    )
  })
})

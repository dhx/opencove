import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { registerTopologyHandlers } from '../../../src/app/main/controlSurface/handlers/topologyHandlers'

const { invokeControlSurfaceMock } = vi.hoisted(() => ({
  invokeControlSurfaceMock: vi.fn(),
}))

vi.mock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
  invokeControlSurface: invokeControlSurfaceMock,
}))

const ctx = { now: () => new Date(), capabilities: {} } as unknown as ControlSurfaceContext

function createSubject() {
  const controlSurface = createControlSurface()
  registerTopologyHandlers(controlSurface, {
    topology: {
      resolveRemoteEndpointConnection: async (endpointId: string) =>
        endpointId === 'remote' ? { hostname: 'example.com', port: 1234, token: 'token' } : null,
    } as never,
    approvedWorkspaces: {
      registerRoot: async () => undefined,
      isPathApproved: async () => true,
    },
    endpointHealth: {} as never,
    readSshConfigHosts: async () => [],
  })
  return { controlSurface }
}

// The remote directory picker browses a remote worker through endpoint.readDirectory.
describe('endpoint.readDirectory', () => {
  beforeEach(() => {
    invokeControlSurfaceMock.mockReset()
  })

  it('browses remote directories without approving them as roots', async () => {
    invokeControlSurfaceMock.mockResolvedValueOnce({
      httpStatus: 200,
      result: {
        __opencoveControlEnvelope: true,
        ok: true,
        value: { entries: [{ name: 'src', uri: 'file:///remote/src', kind: 'directory' }] },
      },
    })

    const { controlSurface } = createSubject()

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'endpoint.readDirectory',
      payload: { endpointId: 'remote', path: '/home/remote-user' },
    })

    expect(result).toMatchObject({
      ok: true,
      value: { path: '/home/remote-user', entries: [{ name: 'src' }] },
    })
    expect(invokeControlSurfaceMock).toHaveBeenCalledTimes(1)
    expect(invokeControlSurfaceMock.mock.calls[0]?.[1]).toMatchObject({
      kind: 'query',
      id: 'filesystem.browseDirectory',
      payload: { uri: 'file:///home/remote-user' },
    })
  })

  it('reads endpoint directories when approveRoot is unsupported on the remote', async () => {
    invokeControlSurfaceMock
      .mockResolvedValueOnce({
        httpStatus: 200,
        result: {
          __opencoveControlEnvelope: true,
          ok: false,
          error: {
            code: 'common.invalid_input',
            debugMessage: 'Error: Unknown control surface query: filesystem.browseDirectory',
          },
        },
      })
      .mockResolvedValueOnce({
        httpStatus: 200,
        result: {
          __opencoveControlEnvelope: true,
          ok: false,
          error: {
            code: 'common.invalid_input',
            debugMessage: 'Error: Unknown control surface command: workspace.approveRoot',
          },
        },
      })
      .mockResolvedValueOnce({
        httpStatus: 200,
        result: {
          __opencoveControlEnvelope: true,
          ok: true,
          value: {
            entries: [
              { name: 'src', uri: 'file:///remote/src', kind: 'directory' },
              { name: 'README.md', uri: 'file:///remote/README.md', kind: 'file' },
            ],
          },
        },
      })

    const { controlSurface } = createSubject()

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'endpoint.readDirectory',
      payload: { endpointId: 'remote', path: '/remote' },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.entries).toHaveLength(2)
      expect(result.value.entries[0]?.name).toBe('src')
    }

    expect(invokeControlSurfaceMock).toHaveBeenCalledTimes(3)
    expect(invokeControlSurfaceMock.mock.calls[0]?.[1]).toMatchObject({
      kind: 'query',
      id: 'filesystem.browseDirectory',
    })
    expect(invokeControlSurfaceMock.mock.calls[1]?.[1]).toMatchObject({
      kind: 'command',
      id: 'workspace.approveRoot',
    })
    expect(invokeControlSurfaceMock.mock.calls[2]?.[1]).toMatchObject({
      kind: 'query',
      id: 'filesystem.readDirectory',
    })
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { registerSessionHandlers } from '../../../src/app/main/controlSurface/handlers/sessionHandlers'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import {
  createReadyTerminalAdmissionDeps,
  createTestAgentProviderRegistry,
} from './controlSurfaceTestTerminalAvailability'

const { resolveAgentLaunchSpawnMock } = vi.hoisted(() => ({
  resolveAgentLaunchSpawnMock: vi.fn(
    async (input: {
      cwd: string
      command: string
      args: string[]
      profileId?: string | null
      env?: NodeJS.ProcessEnv
      executablePathOverride?: string | null
    }) => ({
      ...input,
      profileId: input.profileId ?? null,
      env: input.env ?? {},
      runtimeKind: 'posix' as const,
    }),
  ),
}))

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
  resolveAgentLaunchSpawn: resolveAgentLaunchSpawnMock,
}))

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-10-25T00:00:00.000Z'),
  capabilities: {
    webShell: false,
    sync: { state: true, events: true },
    sessionStreaming: {
      enabled: true,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 400_000,
      roles: { viewer: true, controller: true },
      webAuth: { ticketToCookie: true, cookieSession: true },
    },
  },
}

afterEach(() => {
  vi.unstubAllEnvs()
  resolveAgentLaunchSpawnMock.mockClear()
})

function createStubStore(state: unknown) {
  return {
    readWorkspaceStateRaw: async () => null,
    writeWorkspaceStateRaw: async () => ({ ok: true, level: 'full', bytes: 0 }),
    readAppState: async () => state,
    writeAppState: async () => ({ ok: true, level: 'full', bytes: 1 }),
    readNodeScrollback: async () => null,
    writeNodeScrollback: async () => ({ ok: true, level: 'full', bytes: 0 }),
    consumeRecovery: () => null,
    dispose: () => undefined,
  }
}

function setup(settings: Record<string, unknown>) {
  // Real provider contributions build the command; nothing is executed (spawnSession is a stub).
  vi.stubEnv('OPENCOVE_TEST_USE_REAL_AGENTS', '1')
  const spawnSession = vi.fn(async (_input: { args: string[]; env?: NodeJS.ProcessEnv }) => ({
    sessionId: 'pty-policy',
  }))
  const controlSurface = createControlSurface()
  registerSessionHandlers(controlSurface, {
    ...createReadyTerminalAdmissionDeps(),
    agentProviderRegistry: createTestAgentProviderRegistry(),
    userDataPath: '/tmp/opencove-test-user-data',
    approvedWorkspaces: {
      registerRoot: async () => undefined,
      isPathApproved: async () => true,
    },
    getPersistenceStore: async () => createStubStore({ settings }) as never,
    ptyRuntime: {
      spawnSession,
      write: () => undefined,
      resize: () => undefined,
      kill: () => undefined,
      onData: () => () => undefined,
      onExit: () => () => undefined,
      attach: () => undefined,
      detach: () => undefined,
      snapshot: () => '',
      startSessionStateWatcher: () => undefined,
      dispose: () => undefined,
    },
    ptyStreamHub: {
      registerSessionMetadata: () => undefined,
      hasSession: () => false,
    } as unknown as PtyStreamHub,
    topology: { listMounts: async () => ({ projectId: 'ws1', mounts: [] }) } as never,
  })
  return { controlSurface, spawnSession }
}

const bypassFlagByProvider = {
  'claude-code': '--dangerously-skip-permissions',
  codex: '--dangerously-bypass-approvals-and-sandbox',
  gemini: '--yolo',
  kimi: '--auto',
} as const

const resumeOnlyProviders = new Set<string>(['gemini'])
const policies = ['deny', 'setting', 'allow'] as const
const settingValues = [false, true] as const
const payloadValues = [null, false, true] as const

function expectedFullAccess(
  policy: (typeof policies)[number],
  setting: boolean,
  requested: boolean | null,
): boolean {
  if (policy === 'deny') {
    return false
  }
  if (policy === 'allow') {
    return requested ?? setting
  }
  return setting && requested !== false
}

const cases = (
  Object.keys(bypassFlagByProvider) as Array<keyof typeof bypassFlagByProvider>
).flatMap(provider =>
  policies.flatMap(policy =>
    settingValues.flatMap(setting =>
      payloadValues.map(requested => ({
        provider,
        policy,
        setting,
        requested,
        expected: expectedFullAccess(policy, setting, requested),
      })),
    ),
  ),
)

describe('session.launchAgent full access policy', () => {
  it.each(cases)(
    '$provider: OPENCOVE_AGENT_FULL_ACCESS=$policy, setting=$setting, payload=$requested -> bypass flag $expected',
    async ({ provider, policy, setting, requested, expected }) => {
      vi.stubEnv('OPENCOVE_AGENT_FULL_ACCESS', policy)
      const { controlSurface, spawnSession } = setup({ agentFullAccess: setting })

      const launched = await controlSurface.invoke(ctx, {
        kind: 'command',
        id: 'session.launchAgent',
        payload: {
          cwd: '/repo',
          prompt: '',
          provider,
          // Gemini cannot be picked for new launches in this build, only resumed.
          ...(resumeOnlyProviders.has(provider)
            ? { mode: 'resume', resumeSessionId: 'provider-session' }
            : { mode: 'new' }),
          ...(requested === null ? {} : { agentFullAccess: requested }),
        },
      })

      expect(launched.ok).toBe(true)
      const args = spawnSession.mock.calls[0]?.[0].args ?? []
      expect(args.includes(bypassFlagByProvider[provider])).toBe(expected)
    },
  )

  it('defaults to no bypass flags when nothing is configured', async () => {
    const { controlSurface, spawnSession } = setup({})

    const launched = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.launchAgent',
      payload: { cwd: '/repo', prompt: 'hi', provider: 'codex', mode: 'new' },
    })

    expect(launched.ok).toBe(true)
    const args = spawnSession.mock.calls[0]?.[0].args ?? []
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(args).toEqual(expect.arrayContaining(['--sandbox', 'workspace-write']))
  })

  it('refuses Kimi prompt mode with a clear error instead of enabling full access', async () => {
    vi.stubEnv('OPENCOVE_AGENT_FULL_ACCESS', 'deny')
    const { controlSurface, spawnSession } = setup({ agentFullAccess: true })

    const launched = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.launchAgent',
      payload: {
        cwd: '/repo',
        prompt: 'do it',
        provider: 'kimi',
        mode: 'new',
        agentFullAccess: true,
      },
    })

    expect(launched.ok).toBe(false)
    expect(JSON.stringify(launched)).toContain(
      'Kimi cannot start with a prompt without full access',
    )
    expect(spawnSession).not.toHaveBeenCalled()
  })
})

describe('session.launchAgent overrides from the payload', () => {
  const settings = {
    agentEnvByProvider: {
      codex: [{ id: 'row-1', key: 'FROM_SETTINGS', value: 'configured', enabled: true }],
    },
    agentExecutablePathOverrideByProvider: { codex: '/opt/settings/codex' },
  }

  it('ignores the payload executable and unknown env unless OPENCOVE_ALLOW_LAUNCH_OVERRIDES=1', async () => {
    const { controlSurface, spawnSession } = setup(settings)

    const launched = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.launchAgent',
      payload: {
        cwd: '/repo',
        prompt: '',
        provider: 'codex',
        mode: 'new',
        executablePathOverride: '/tmp/evil-binary',
        env: { FROM_SETTINGS: 'configured', INJECTED_SECRET_SINK: 'evil' },
      },
    })

    expect(launched.ok).toBe(true)
    expect(resolveAgentLaunchSpawnMock).toHaveBeenCalledWith(
      expect.objectContaining({ executablePathOverride: '/opt/settings/codex' }),
    )
    const env = spawnSession.mock.calls[0]?.[0].env ?? {}
    expect(env.FROM_SETTINGS).toBe('configured')
    expect(env).not.toHaveProperty('INJECTED_SECRET_SINK')
  })

  it('passes payload overrides through when OPENCOVE_ALLOW_LAUNCH_OVERRIDES=1', async () => {
    vi.stubEnv('OPENCOVE_ALLOW_LAUNCH_OVERRIDES', '1')
    const { controlSurface, spawnSession } = setup(settings)

    const launched = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.launchAgent',
      payload: {
        cwd: '/repo',
        prompt: '',
        provider: 'codex',
        mode: 'new',
        executablePathOverride: '/opt/custom/codex',
        env: { EXTRA: 'value' },
      },
    })

    expect(launched.ok).toBe(true)
    expect(resolveAgentLaunchSpawnMock).toHaveBeenCalledWith(
      expect.objectContaining({ executablePathOverride: '/opt/custom/codex' }),
    )
    expect(spawnSession.mock.calls[0]?.[0].env?.EXTRA).toBe('value')
  })
})

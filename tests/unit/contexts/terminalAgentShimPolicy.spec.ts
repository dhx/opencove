import { describe, expect, it, vi } from 'vitest'
import {
  areTerminalAgentShimsEnabled,
  TerminalAgentActivityEnvironmentService,
} from '../../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityEnvironmentService'
import {
  pickTerminalAgentForwardedEnvironment,
  terminalAgentLauncherScript,
} from '../../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentTelemetryScripts'

function createService(enabled: boolean | undefined) {
  const ensure = vi.fn(async () => ({
    rootDirectory: '/assets',
    shimDirectory: '/assets/bin',
    launcherPath: '/assets/launcher.mjs',
    shellLauncherPath: '/assets/shell',
    bashRcPath: '/assets/bashrc',
    zshDotDirectory: '/assets/zsh',
    planDirectory: '/assets/plans',
  }))
  const reserveTerminal = vi.fn(async () => ({
    endpoint: 'http://127.0.0.1:1/terminal-agent',
    token: 'gateway-token',
    commit: () => undefined,
    dispose: async () => undefined,
  }))
  const service = new TerminalAgentActivityEnvironmentService({
    assets: { ensure } as never,
    gateway: { reserveTerminal } as never,
    inheritedPath: '/usr/bin:/bin',
    inheritedShell: '/bin/bash',
    platform: 'linux',
    ...(enabled === undefined ? {} : { enabled }),
  })
  return { service, ensure, reserveTerminal }
}

describe('terminal Agent shims', () => {
  it.each([
    [undefined, true],
    ['1', true],
    ['0', false],
    ['false', false],
    ['OFF', false],
  ] as const)('OPENCOVE_TERMINAL_AGENT_SHIMS=%j -> enabled %s', (raw, expected) => {
    expect(areTerminalAgentShimsEnabled({ OPENCOVE_TERMINAL_AGENT_SHIMS: raw })).toBe(expected)
  })

  it('leaves the shell, its startup files and PATH alone when turned off', async () => {
    const { service, ensure, reserveTerminal } = createService(false)
    const environment = { PATH: '/home/alice/bin:/usr/bin', HOME: '/home/alice' }

    const prepared = await service.prepare({
      args: ['-l'],
      command: '/bin/bash',
      cwd: '/repo',
      environment,
      interactiveShell: true,
    })

    expect(prepared.command).toBe('/bin/bash')
    expect(prepared.args).toEqual(['-l'])
    expect(prepared.environment).toEqual(environment)
    expect(ensure).not.toHaveBeenCalled()
    expect(reserveTerminal).not.toHaveBeenCalled()
  })

  it('still installs the shims by default', async () => {
    const { service } = createService(undefined)

    const prepared = await service.prepare({
      args: [],
      command: '/bin/bash',
      cwd: '/repo',
      environment: { PATH: '/usr/bin' },
      interactiveShell: true,
    })

    expect(prepared.command).toBe('/assets/shell')
    expect(prepared.environment?.PATH?.split(':')[0]).toBe('/assets/bin')
  })

  it('forwards only allow-listed variables to the gateway', () => {
    expect(
      pickTerminalAgentForwardedEnvironment({
        PATH: '/usr/bin',
        HOME: '/home/alice',
        CODEX_HOME: '/home/alice/.codex',
        Path: 'C:\\Windows',
        SystemRoot: 'C:\\Windows',
        AWS_SECRET_ACCESS_KEY: 'secret',
        GITHUB_TOKEN: 'secret',
        OPENCOVE_TERMINAL_AGENT_TOKEN: 'secret',
        NOT_A_STRING: undefined,
      }),
    ).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/alice',
      CODEX_HOME: '/home/alice/.codex',
      Path: 'C:\\Windows',
      SystemRoot: 'C:\\Windows',
    })
  })

  it('does not post the whole shell environment from the launcher script', () => {
    expect(terminalAgentLauncherScript).not.toContain('environment: process.env')
    expect(terminalAgentLauncherScript).toContain('environment: forwardedEnvironment(process.env)')
    expect(terminalAgentLauncherScript).toContain('"CODEX_HOME"')
  })
})

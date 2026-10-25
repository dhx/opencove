// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn(() => ({ on: vi.fn() })))

vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('node:fs', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: () => true,
}))
vi.mock('../../../src/app/cli/runtime.mjs', () => ({
  createWorkerSpawnEnvironment: (_kind: string, env: NodeJS.ProcessEnv) => ({ ...env }),
  resolveCliAppVersion: () => '1.2.3',
  resolveCliRuntime: () => ({ kind: 'source', workerScriptPath: '/opencove/out/main/worker.js' }),
  resolveWorkerRuntimeForStart: async () => ({ kind: 'node', executablePath: '/usr/bin/node' }),
}))

describe('opencove worker start', () => {
  beforeEach(() => {
    spawnMock.mockClear()
  })

  it('hands secrets to the Worker through its environment, not its argv', async () => {
    const { startWorker } = await import('../../../src/app/cli/workerStart.mjs')
    await startWorker([
      'worker',
      'start',
      '--hostname',
      '0.0.0.0',
      '--token',
      'cli-secret-token',
      '--web-ui-password',
      'cli-secret-password',
      '--allow-insecure-bind',
    ])

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [, args, options] = spawnMock.mock.calls[0] as unknown as [
      string,
      string[],
      { env: Record<string, string> },
    ]
    expect(args.join(' ')).not.toContain('cli-secret')
    expect(args).toContain('--allow-insecure-bind')
    expect(options.env.OPENCOVE_WORKER_TOKEN).toBe('cli-secret-token')
    expect(options.env.OPENCOVE_WEB_UI_PASSWORD).toBe('cli-secret-password')
  })

  it('passes secret file paths through as flags', async () => {
    const { startWorker } = await import('../../../src/app/cli/workerStart.mjs')
    await startWorker([
      'worker',
      'start',
      '--token-file',
      '/run/secrets/token',
      '--web-ui-password-file',
      '/run/secrets/password',
    ])

    const [, args] = spawnMock.mock.calls[0] as unknown as [string, string[]]
    expect(args).toContain('--token-file=/run/secrets/token')
    expect(args).toContain('--web-ui-password-file=/run/secrets/password')
  })
})

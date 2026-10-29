import { fork } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createNodeChildPtyHostProcess } from '../../../../platform/process/ptyHost/nodeProcessAdapter'
import type { PtyHostProcess } from '../../../../platform/process/ptyHost/processTypes'

/**
 * What the voice host inherits from the worker. It runs third-party model code and needs no
 * credentials, so it gets only what Node and onnxruntime read: never the worker token, the Web UI
 * password or an agent's API key.
 */
const VOICE_HOST_ENV_NAMES = [
  'PATH',
  'HOME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'TZ',
  'OMP_NUM_THREADS',
  'ORT_NUM_THREADS',
] as const

export function createVoiceHostEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const hostEnv: NodeJS.ProcessEnv = {}
  for (const name of VOICE_HOST_ENV_NAMES) {
    if (env[name] !== undefined) {
      hostEnv[name] = env[name]
    }
  }
  return hostEnv
}

/** The built `voiceHost.js` sits in `out/main`, beside the worker or one folder above a chunk. */
export function resolveBundledVoiceHostEntryPath(baseDir: string): string {
  const candidates = [join(baseDir, 'voiceHost.js'), join(baseDir, '..', 'voiceHost.js')]
  const resolved = candidates.find(candidate => existsSync(candidate))
  if (!resolved) {
    throw new Error(`[voice-host] missing entry: ${candidates.join(', ')}`)
  }
  return resolved
}

export function forkVoiceHost(options: {
  baseDir: string
  env: NodeJS.ProcessEnv
}): PtyHostProcess {
  return createNodeChildPtyHostProcess(
    fork(resolveBundledVoiceHostEntryPath(options.baseDir), [], {
      // Float32Array audio crosses as is; the default JSON serialization would turn it into a map.
      serialization: 'advanced',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: createVoiceHostEnv(options.env),
    }),
  )
}

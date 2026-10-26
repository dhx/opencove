import { readFileSync } from 'node:fs'
import { readWorkerFlagValue } from './workerCliArguments'

/** Bearer token for the control surface, read when `--token`/`--token-file` are absent. */
export const WORKER_TOKEN_ENV = 'OPENCOVE_WORKER_TOKEN'
/** Plain Web UI password, read when no password flag is given. */
export const WEB_UI_PASSWORD_ENV = 'OPENCOVE_WEB_UI_PASSWORD'
/** Web UI password hash (scrypt), read when no password flag is given. */
export const WEB_UI_PASSWORD_HASH_ENV = 'OPENCOVE_WEB_UI_PASSWORD_HASH'

const WORKER_SECRET_ENV_KEYS = [
  WORKER_TOKEN_ENV,
  WEB_UI_PASSWORD_ENV,
  WEB_UI_PASSWORD_HASH_ENV,
] as const

export interface WorkerSecrets {
  token: string | null
  webUiPassword: string | null
  webUiPasswordHash: string | null
}

type ReadSecretFile = (path: string) => string

function readSecretFileFromDisk(path: string): string {
  return readFileSync(path, 'utf8')
}

function normalizeSecret(value: string | undefined | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readSecretFromFile(flag: string, path: string, readFile: ReadSecretFile): string {
  let raw: string
  try {
    raw = readFile(path)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`[worker] cannot read ${flag} ${path}: ${detail}`, { cause: error })
  }

  const secret = normalizeSecret(raw)
  if (!secret) {
    throw new Error(`[worker] ${flag} ${path} is empty`)
  }
  return secret
}

function resolveOneOf(
  argv: readonly string[],
  options: {
    valueFlag: string
    fileFlag: string
    env: NodeJS.ProcessEnv
    envKey: string
    readFile: ReadSecretFile
  },
): string | null {
  const flagValue = readWorkerFlagValue(argv, options.valueFlag)
  const filePath = readWorkerFlagValue(argv, options.fileFlag)
  if (flagValue && filePath) {
    throw new Error(`[worker] choose either ${options.valueFlag} or ${options.fileFlag}`)
  }
  if (flagValue) {
    return flagValue
  }
  if (filePath) {
    return readSecretFromFile(options.fileFlag, filePath, options.readFile)
  }
  return normalizeSecret(options.env[options.envKey])
}

/**
 * Secrets can come from a flag (kept for compatibility; visible in the process list), a file
 * flag, or the environment. Flags win over the environment so an explicit command line is never
 * silently overridden.
 */
export function resolveWorkerSecrets(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  readFile: ReadSecretFile = readSecretFileFromDisk,
): WorkerSecrets {
  const token = resolveOneOf(argv, {
    valueFlag: '--token',
    fileFlag: '--token-file',
    env,
    envKey: WORKER_TOKEN_ENV,
    readFile,
  })

  const passwordFromFlags = (() => {
    const flagValue = readWorkerFlagValue(argv, '--web-ui-password')
    const filePath = readWorkerFlagValue(argv, '--web-ui-password-file')
    if (flagValue && filePath) {
      throw new Error('[worker] choose either --web-ui-password or --web-ui-password-file')
    }
    return (
      flagValue ??
      (filePath ? readSecretFromFile('--web-ui-password-file', filePath, readFile) : null)
    )
  })()
  const hashFromFlags = readWorkerFlagValue(argv, '--web-ui-password-hash')

  let webUiPassword = passwordFromFlags
  let webUiPasswordHash = hashFromFlags
  if (!webUiPassword && !webUiPasswordHash) {
    webUiPassword = normalizeSecret(env[WEB_UI_PASSWORD_ENV])
    webUiPasswordHash = normalizeSecret(env[WEB_UI_PASSWORD_HASH_ENV])
  }

  if (webUiPassword && webUiPasswordHash) {
    throw new Error('[worker] choose either --web-ui-password or --web-ui-password-hash')
  }

  return { token, webUiPassword, webUiPasswordHash }
}

/**
 * Remove the secret variables from this process's environment so terminals, agents and plugin
 * hosts started by the Worker do not inherit them.
 */
export function scrubWorkerSecretEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of WORKER_SECRET_ENV_KEYS) {
    delete env[key]
  }
}

/**
 * The connection info printed on stdout. A Desktop parent reads the token from its private pipe;
 * everyone else (a terminal, a container log) gets the connection file's path instead.
 */
export function formatWorkerReadyLine(
  info: { token?: unknown } & Record<string, unknown>,
  options: { includeToken: boolean; connectionFilePath: string },
): string {
  if (options.includeToken) {
    return `${JSON.stringify(info)}\n`
  }

  const { token: _token, ...rest } = info
  return `${JSON.stringify({ ...rest, tokenRedacted: true, connectionFile: options.connectionFilePath })}\n`
}

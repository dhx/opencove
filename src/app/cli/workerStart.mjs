import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFlagValue } from './args.mjs'
import {
  createWorkerSpawnEnvironment,
  resolveCliAppVersion,
  resolveCliRuntime,
  resolveWorkerRuntimeForStart,
} from './runtime.mjs'

export async function startWorker(argv) {
  const token = readFlagValue(argv, '--token')
  const runtime = resolveCliRuntime()
  const workerPath = runtime.workerScriptPath
  const appVersion = resolveCliAppVersion(runtime)

  if (!existsSync(workerPath)) {
    process.stderr.write(
      runtime.kind === 'source'
        ? '[opencove] worker is not built. Run `pnpm build` first.\n'
        : `[opencove] worker entry is missing: ${workerPath}\n`,
    )
    process.exit(2)
  }

  if (runtime.kind === 'standalone' && appVersion === null) {
    process.stderr.write(
      '[opencove] standalone runtime package version is missing or invalid; refusing to start an unidentified Worker.\n',
    )
    process.exit(2)
  }

  const workerArgs = []
  const hostname = readFlagValue(argv, '--hostname')
  const advertiseHostname = readFlagValue(argv, '--advertise-hostname')
  const port = readFlagValue(argv, '--port')
  const userData = readFlagValue(argv, '--user-data')
  const webUiPasswordHash = readFlagValue(argv, '--web-ui-password-hash')
  const webUiPassword = readFlagValue(argv, '--web-ui-password')
  const tokenFile = readFlagValue(argv, '--token-file')
  const webUiPasswordFile = readFlagValue(argv, '--web-ui-password-file')
  const approvedRoots = []

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--approve-root') {
      continue
    }

    const next = argv[index + 1]
    if (!next || next.startsWith('-')) {
      continue
    }

    const normalized = next.trim()
    if (normalized.length > 0) {
      approvedRoots.push(normalized)
    }
  }

  if (hostname) {
    workerArgs.push('--hostname', hostname)
  }

  workerArgs.push('--started-by', 'cli')
  if (appVersion !== null) {
    workerArgs.push(`--app-version=${appVersion}`)
  }

  if (advertiseHostname) {
    workerArgs.push('--advertise-hostname', advertiseHostname)
  }

  if (port) {
    workerArgs.push('--port', port)
  }

  if (userData) {
    workerArgs.push('--user-data', userData)
  }

  // Secrets go to the Worker through its environment, never its argv: every local user can read
  // a process's command line. File flags only carry a path.
  const secretEnv = {}
  if (token) {
    secretEnv.OPENCOVE_WORKER_TOKEN = token
  }

  if (tokenFile) {
    workerArgs.push(`--token-file=${tokenFile}`)
  }

  if (webUiPasswordHash) {
    secretEnv.OPENCOVE_WEB_UI_PASSWORD_HASH = webUiPasswordHash
  }

  if (webUiPassword) {
    secretEnv.OPENCOVE_WEB_UI_PASSWORD = webUiPassword
  }

  if (webUiPasswordFile) {
    workerArgs.push(`--web-ui-password-file=${webUiPasswordFile}`)
  }

  for (const flag of ['--allow-insecure-bind', '--allow-query-token']) {
    if (argv.includes(flag)) {
      workerArgs.push(flag)
    }
  }

  for (const root of approvedRoots) {
    workerArgs.push('--approve-root', root)
  }

  let workerRuntime
  try {
    workerRuntime = await resolveWorkerRuntimeForStart({ cliRuntime: runtime })
  } catch (error) {
    process.stderr.write(`[opencove] ${error instanceof Error ? error.message : String(error)}.\n`)
    process.exit(2)
  }

  const shouldDisableSandbox =
    process.platform === 'linux' &&
    (process.env.CI === '1' ||
      process.env.CI?.toLowerCase() === 'true' ||
      (typeof process.getuid === 'function' && process.getuid() === 0))

  const child = spawn(workerRuntime.executablePath, [workerPath, ...workerArgs], {
    stdio: 'inherit',
    env: {
      ...createWorkerSpawnEnvironment(workerRuntime.kind, process.env, {
        disableElectronSandbox: shouldDisableSandbox,
      }),
      ...secretEnv,
    },
    windowsHide: true,
  })
  child.on('exit', code => {
    process.exit(code ?? 1)
  })

  return
}

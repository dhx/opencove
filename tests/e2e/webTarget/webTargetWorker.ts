import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import path from 'node:path'

// Starts the headless worker. By default from the built app (`out/main/worker.js`) the same way
// `scripts/test-e2e-web-canvas.mjs` does: under Electron's Node (`ELECTRON_RUN_AS_NODE=1`), because
// the native modules in node_modules are built for Electron's ABI. With OPENCOVE_E2E_WEB_SERVER_DIR set
// to an unpacked server bundle (`opencove-server-linux-x64`), it runs that bundle's own Node and app,
// i.e. exactly what a release ships.

const repoRoot = path.resolve(__dirname, '../../../')
const WORKER_READY_TIMEOUT_MS = 45_000
const WORKER_STOP_TIMEOUT_MS = 5_000
const WORKER_LOG_TAIL_LINES = 40

export interface StartedWebTargetWorker {
  baseUrl: string
  token: string
  process: ChildProcess
  stop: () => Promise<void>
  logTail: () => string
}

function resolveElectronBinary(): string {
  const requireFromRepo = createRequire(path.join(repoRoot, 'package.json'))
  const electronBinary = requireFromRepo('electron') as unknown
  if (typeof electronBinary !== 'string' || electronBinary.length === 0) {
    throw new Error('[e2e-web] Could not resolve the Electron binary to run the worker with')
  }

  return electronBinary
}

function isTruthyEnv(rawValue: string | undefined): boolean {
  return rawValue === '1' || rawValue?.toLowerCase() === 'true'
}

function killWorkerTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (typeof child.pid !== 'number') {
    return
  }

  try {
    // The worker runs in its own process group, so its terminals go with it.
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // already gone
    }
  }
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true
  }

  return await new Promise(resolve => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}

function resolveWorkerCommand(): { command: string; workerPath: string; cwd: string } {
  const serverDir = process.env['OPENCOVE_E2E_WEB_SERVER_DIR']?.trim()
  if (serverDir) {
    const bundleRoot = path.resolve(serverDir)
    return {
      command: path.join(bundleRoot, 'runtime', 'node', 'bin', 'node'),
      workerPath: path.join(bundleRoot, 'app', 'out', 'main', 'worker.js'),
      cwd: path.join(bundleRoot, 'app'),
    }
  }

  return {
    command: resolveElectronBinary(),
    workerPath: path.join(repoRoot, 'out', 'main', 'worker.js'),
    cwd: repoRoot,
  }
}

export async function startWebTargetWorker(options: {
  userDataDir: string
  approvedRoots: string[]
  env: Record<string, string>
}): Promise<StartedWebTargetWorker> {
  const token = randomBytes(24).toString('hex')
  const { command, workerPath, cwd } = resolveWorkerCommand()
  const args = [
    workerPath,
    '--hostname',
    '127.0.0.1',
    '--port',
    '0',
    '--user-data',
    options.userDataDir,
    ...options.approvedRoots.flatMap(root => ['--approve-root', root]),
  ]

  const child = spawn(command, args, {
    cwd,
    detached: process.platform !== 'win32',
    env: {
      ...options.env,
      ELECTRON_RUN_AS_NODE: '1',
      // The token goes through the environment, never argv (the worker scrubs it after reading).
      OPENCOVE_WORKER_TOKEN: token,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const logLines: string[] = []
  const pipeLogs = isTruthyEnv(process.env['OPENCOVE_E2E_PIPE_ELECTRON_LOGS'])
  const remember = (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    if (pipeLogs) {
      process.stderr.write(text)
    }
    logLines.push(...text.split('\n').filter(line => line.length > 0))
    if (logLines.length > WORKER_LOG_TAIL_LINES) {
      logLines.splice(0, logLines.length - WORKER_LOG_TAIL_LINES)
    }
  }
  child.stderr?.on('data', remember)
  const logTail = () => logLines.join('\n')

  const ready = await new Promise<{ hostname: string; port: number }>((resolve, reject) => {
    if (!child.stdout) {
      reject(new Error('[e2e-web] Worker stdout not available'))
      return
    }

    const rl = createInterface({ input: child.stdout })
    const timer = setTimeout(() => {
      rl.close()
      reject(new Error(`[e2e-web] Timed out waiting for the worker to start\n${logTail()}`))
    }, WORKER_READY_TIMEOUT_MS)

    rl.on('line', line => {
      try {
        const info = JSON.parse(line) as { hostname?: unknown; port?: unknown }
        if (typeof info.hostname === 'string' && typeof info.port === 'number') {
          clearTimeout(timer)
          rl.close()
          child.stdout?.on('data', remember)
          resolve({ hostname: info.hostname, port: info.port })
        }
      } catch {
        // not the ready line
      }
    })

    child.once('error', error => {
      clearTimeout(timer)
      rl.close()
      reject(error)
    })
    child.once('exit', code => {
      clearTimeout(timer)
      rl.close()
      reject(new Error(`[e2e-web] Worker exited before ready (code=${code})\n${logTail()}`))
    })
  }).catch(async error => {
    killWorkerTree(child, 'SIGKILL')
    await waitForExit(child, WORKER_STOP_TIMEOUT_MS)
    throw error
  })

  let stopPromise: Promise<void> | null = null
  const stop = async () => {
    stopPromise ??= (async () => {
      child.kill('SIGTERM')
      const exited = await waitForExit(child, WORKER_STOP_TIMEOUT_MS)
      // Terminal processes outlive a graceful stop only by accident; a forced stop takes them along.
      killWorkerTree(child, 'SIGKILL')
      if (!exited) {
        await waitForExit(child, WORKER_STOP_TIMEOUT_MS)
      }
    })()
    await stopPromise
  }

  return {
    baseUrl: `http://${ready.hostname}:${ready.port}`,
    token,
    process: child,
    stop,
    logTail,
  }
}

export async function issueWebSessionTicket(baseUrl: string, token: string): Promise<string> {
  const response = await fetch(`${baseUrl}/invoke`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'query',
      id: 'auth.issueWebSessionTicket',
      payload: { redirectPath: '/' },
    }),
  })
  const envelope = (await response.json()) as
    | { ok: true; value: { ticket: string } }
    | { ok: false; error?: { code?: string } }
  if (!response.ok || !envelope.ok) {
    throw new Error(
      `[e2e-web] Could not issue a web session ticket: ${response.status} ${
        envelope.ok ? '' : (envelope.error?.code ?? 'unknown_error')
      }`,
    )
  }

  return envelope.value.ticket
}

import {
  chromium,
  type BrowserContext,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createTestUserDataDir, resolveE2ETmpDir } from '../workspace-canvas.testUtils'
import { createElectronStandIn } from './electronStandIn'
import { resolveWebTargetInitScriptArgs, webTargetInitScript } from './webTargetInitScript'
import { issueWebSessionTicket, startWebTargetWorker } from './webTargetWorker'

// `OPENCOVE_E2E_TARGET=web`: the Electron E2E suite against the headless worker and its Web UI in
// Chromium. One launch = one worker (its own user data dir) + one browser profile kept inside that
// dir, so relaunching with the same `userDataDir` is a restart with the same data, like the desktop app.

const repoRoot = path.resolve(__dirname, '../../../')
const testAgentStubScriptPath = path.join(repoRoot, 'scripts', 'test-agent-session-stub.mjs')
// Electron opens its E2E window with a 1440x900 content size in every window mode.
const E2E_VIEWPORT = { width: 1440, height: 900 }
const WEB_UI_LOAD_TIMEOUT_MS = 45_000

// Specs serve test websites from 127.0.0.1. The fork's Web UI refuses to embed a site on its own host
// (cookies are not isolated by port), so the UI is opened as `localhost`: a different host, as the
// desktop app's own origin is too.
function resolvePageBaseUrl(workerBaseUrl: string): string {
  const url = new URL(workerBaseUrl)
  if (url.hostname === '127.0.0.1') {
    url.hostname = 'localhost'
  }
  return url.origin
}

export function isWebE2ETarget(): boolean {
  return process.env['OPENCOVE_E2E_TARGET']?.trim().toLowerCase() === 'web'
}

type VideoOptions = { dir: string; size?: { width: number; height: number } }

export interface WebTargetLaunchOptions {
  windowMode?: string
  env?: Record<string, string | undefined>
  userDataDir?: string
  cleanupUserDataDir?: boolean
  deviceScaleFactor?: number
  recordVideo?: VideoOptions
}

function definedEnv(source: Record<string, string | undefined>): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') {
      next[key] = value
    }
  }
  return next
}

function resolveChromiumArgs(): string[] {
  // A fake microphone that is granted without a prompt, for the voice specs.
  const fakeMedia = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  return process.platform === 'linux' ? ['--disable-dev-shm-usage', ...fakeMedia] : fakeMedia
}

export async function launchWebApp(
  options: WebTargetLaunchOptions = {},
): Promise<{ electronApp: ElectronApplication; window: Page }> {
  const userDataDir = options.userDataDir ?? (await createTestUserDataDir())
  const cleanupUserDataDir = options.cleanupUserDataDir ?? true
  const homeDir = path.join(userDataDir, 'home')
  const configDir = path.join(userDataDir, 'config')
  const cacheDir = path.join(userDataDir, 'cache')
  const runtimeDir = path.join(userDataDir, 'runtime')
  const browserProfileDir = path.join(userDataDir, 'web-target-browser')
  await mkdir(homeDir, { recursive: true })
  await mkdir(configDir, { recursive: true })
  await mkdir(cacheDir, { recursive: true })
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 })

  const inherited = definedEnv(process.env)
  delete inherited['ELECTRON_RUN_AS_NODE']
  delete inherited['OPENCOVE_WORKER_TOKEN']
  delete inherited['OPENCOVE_WEB_UI_PASSWORD']
  const env: Record<string, string> = {
    ...inherited,
    NODE_ENV: 'test',
    HOME: homeDir,
    USERPROFILE: homeDir,
    XDG_CONFIG_HOME: configDir,
    XDG_CACHE_HOME: cacheDir,
    XDG_RUNTIME_DIR: runtimeDir,
    OPENCOVE_TEST_WORKSPACE: repoRoot,
    OPENCOVE_TEST_USER_DATA_DIR: userDataDir,
    OPENCOVE_TEST_AGENT_STUB_SCRIPT: testAgentStubScriptPath,
    OPENCOVE_TEST_NODE_EXECUTABLE: process.execPath,
    OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '1',
    ...definedEnv(options.env ?? {}),
  }

  // The desktop app approves OPENCOVE_TEST_WORKSPACE at startup; specs also put workspaces in the
  // E2E temp dir and the OS temp dir.
  const approvedRoots = [
    ...new Set([
      path.resolve(env['OPENCOVE_TEST_WORKSPACE'] ?? repoRoot),
      path.join(resolveE2ETmpDir(), 'opencove-e2e'),
      tmpdir(),
    ]),
  ]
  await mkdir(path.join(resolveE2ETmpDir(), 'opencove-e2e'), { recursive: true })

  // The browser keeps its data (localStorage, cookies) per origin, so a restart on the same user data
  // dir reuses the previous port, as a real deployment keeps its address.
  const portFile = path.join(userDataDir, 'web-target-port')
  const previousPort = Number.parseInt(await readFile(portFile, 'utf8').catch(() => ''), 10)
  const worker = await startWebTargetWorker({
    userDataDir,
    approvedRoots,
    env,
    port: Number.isInteger(previousPort) && previousPort > 0 ? previousPort : 0,
  }).catch(async error => {
    if (!(previousPort > 0)) {
      throw error
    }
    // The previous port was taken in the meantime; a new origin is better than no restart.
    return await startWebTargetWorker({ userDataDir, approvedRoots, env, port: 0 })
  })
  await writeFile(portFile, String(new URL(worker.baseUrl).port))
  let context: BrowserContext | null = null

  let closePromise: Promise<void> | null = null
  const close = async (): Promise<void> => {
    closePromise ??= (async () => {
      await context?.close().catch(() => undefined)
      await worker.stop()
      if (cleanupUserDataDir) {
        await rm(userDataDir, { recursive: true, force: true, maxRetries: 5 }).catch(
          () => undefined,
        )
      }
    })()
    await closePromise
  }

  try {
    const deviceScaleFactor =
      typeof options.deviceScaleFactor === 'number' &&
      Number.isFinite(options.deviceScaleFactor) &&
      options.deviceScaleFactor > 0
        ? options.deviceScaleFactor
        : undefined

    context = await chromium.launchPersistentContext(browserProfileDir, {
      headless: true,
      args: resolveChromiumArgs(),
      viewport: E2E_VIEWPORT,
      ...(deviceScaleFactor ? { deviceScaleFactor } : {}),
      ...(options.recordVideo ? { recordVideo: options.recordVideo } : {}),
      permissions: ['clipboard-read', 'clipboard-write'],
    })
    await context.addInitScript(webTargetInitScript, resolveWebTargetInitScriptArgs(env))

    const page = context.pages()[0] ?? (await context.newPage())
    const ticket = await issueWebSessionTicket(worker.baseUrl, worker.token)
    await page.goto(
      `${resolvePageBaseUrl(worker.baseUrl)}/auth/claim?ticket=${encodeURIComponent(ticket)}`,
      {
        waitUntil: 'domcontentloaded',
        timeout: WEB_UI_LOAD_TIMEOUT_MS,
      },
    )
    await page.waitForFunction(() => Boolean(globalThis.window?.opencoveApi), null, {
      timeout: WEB_UI_LOAD_TIMEOUT_MS,
    })

    const electronApp = createElectronStandIn({
      close,
      context: () => context,
      page: () => page,
      workerProcess: worker.process,
      userDataDir,
      env,
    })
    return { electronApp, window: page }
  } catch (error) {
    const tail = worker.logTail()
    await close()
    if (error instanceof Error && tail.length > 0) {
      error.message = `${error.message}\n[e2e-web] worker log tail:\n${tail}`
    }
    throw error
  }
}

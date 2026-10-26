import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'
import type { BrowserContext, ElectronApplication, Page } from '@playwright/test'

export const ELECTRON_ONLY_MESSAGE = 'Electron-only (OPENCOVE_E2E_TARGET=web)'

export interface ElectronStandInTarget {
  close: () => Promise<void>
  context: () => BrowserContext | null
  page: () => Page
  workerProcess: ChildProcess | null
  userDataDir: string
  /** The environment the worker runs with; `process.env` of the stand-in main process. */
  env: Record<string, string>
}

function electronOnly(what: string): Error {
  return new Error(`${ELECTRON_ONLY_MESSAGE}: ${what} is not available`)
}

// A record whose unknown members throw the Electron-only error instead of being `undefined`.
function strictRecord<T extends object>(name: string, members: T): T {
  return new Proxy(members, {
    get(target, property) {
      if (property in target) {
        return (target as Record<PropertyKey, unknown>)[property]
      }
      if (typeof property === 'symbol' || property === 'then' || property === 'toJSON') {
        return undefined
      }
      throw electronOnly(`${name}.${String(property)}`)
    },
  })
}

// What the web target offers in place of the Electron main process: the browser viewport stands in for
// the BrowserWindow, the page's clipboard for Electron's, quitting for closing. Functions passed to
// `electronApp.evaluate()` run in an isolated VM context that holds only these, so code meant for the
// main process can never touch the test runner's own globals; anything else fails as Electron-only.
function createElectronModules(target: ElectronStandInTarget, pending: Promise<unknown>[]) {
  // Electron's calls are synchronous; here each becomes a page operation, run in call order.
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation)
    queue = next.catch(() => undefined)
    pending.push(queue)
    return next
  }
  const initial = target.page().viewportSize() ?? { width: 1440, height: 900 }
  const size = { width: initial.width, height: initial.height }
  const resize = (width: number, height: number) => {
    size.width = Math.round(width)
    size.height = Math.round(height)
    const requested = { ...size }
    void enqueue(() => target.page().setViewportSize(requested))
  }

  const browserWindow = strictRecord('BrowserWindow', {
    isDestroyed: () => target.page().isClosed(),
    isVisible: () => !target.page().isClosed(),
    getContentSize: () => [size.width, size.height],
    getSize: () => [size.width, size.height],
    getBounds: () => ({ x: 0, y: 0, width: size.width, height: size.height }),
    setContentSize: resize,
    setSize: resize,
    setBounds: (bounds: { width?: number; height?: number }) =>
      resize(bounds.width ?? size.width, bounds.height ?? size.height),
  })

  const clipboard = strictRecord('clipboard', {
    readText: () =>
      enqueue(() => target.page().evaluate(async () => await navigator.clipboard.readText())),
    writeText: (text: string) => {
      void enqueue(() =>
        target.page().evaluate(async value => await navigator.clipboard.writeText(value), text),
      )
    },
    clear: () => {
      void enqueue(() =>
        target.page().evaluate(async () => await navigator.clipboard.writeText('')),
      )
    },
  })

  const app = strictRecord('app', {
    quit: () => {
      void enqueue(() => target.close())
    },
    getPath: (name: string) => {
      if (name === 'userData') {
        return target.userDataDir
      }
      throw electronOnly(`app.getPath('${name}')`)
    },
  })

  return strictRecord('electron', {
    app,
    clipboard,
    BrowserWindow: strictRecord('BrowserWindow', {
      getAllWindows: () => (target.page().isClosed() ? [] : [browserWindow]),
    }),
    browserWindow,
  })
}

async function runInStandIn(
  target: ElectronStandInTarget,
  fn: unknown,
  pickModule: (modules: ReturnType<typeof createElectronModules>) => unknown,
  arg: unknown,
): Promise<unknown> {
  if (typeof fn !== 'function') {
    throw electronOnly('evaluate() with a non-function')
  }

  const pending: Promise<unknown>[] = []
  const modules = createElectronModules(target, pending)
  const sandbox = Object.assign(Object.create(null) as Record<string, unknown>, {
    process: strictRecord('process', { env: { ...target.env }, platform: process.platform }),
  })
  const isolated = vm.runInNewContext(`(${fn.toString()})`, sandbox) as (
    first: unknown,
    second: unknown,
  ) => unknown
  const result = await isolated(pickModule(modules), arg)
  await Promise.all(pending)
  return result
}

// What `launchApp()` hands back as `electronApp` in web mode.
export function createElectronStandIn(target: ElectronStandInTarget): ElectronApplication {
  const events = new EventEmitter()
  let closed = false
  const close = async () => {
    await target.close()
    if (!closed) {
      closed = true
      events.emit('close')
    }
  }
  const standInTarget = { ...target, close }

  const members = {
    close,
    process: () => {
      if (!target.workerProcess) {
        throw electronOnly('electronApp.process() while attached to a worker the test started')
      }
      return target.workerProcess
    },
    windows: () => target.context()?.pages() ?? [],
    firstWindow: async () => target.page(),
    context: () => target.context(),
    evaluate: async (fn: unknown, arg?: unknown) =>
      await runInStandIn(standInTarget, fn, modules => modules, arg),
    browserWindow: async (page: Page) => {
      if (page !== target.page()) {
        throw electronOnly('browserWindow() for a page other than the main window')
      }
      return strictRecord('browserWindow handle', {
        evaluate: async (fn: unknown, arg?: unknown) =>
          await runInStandIn(standInTarget, fn, modules => modules.browserWindow, arg),
      })
    },
    once: (event: string, listener: () => void) => {
      if (event !== 'close') {
        throw electronOnly(`electronApp.once('${event}')`)
      }
      events.once('close', listener)
      return proxy
    },
    on: (event: string, listener: () => void) => {
      if (event !== 'close') {
        throw electronOnly(`electronApp.on('${event}')`)
      }
      events.on('close', listener)
      return proxy
    },
    waitForEvent: async (event: string, options?: { timeout?: number } | number) => {
      if (event !== 'close') {
        throw electronOnly(`electronApp.waitForEvent('${event}')`)
      }
      if (closed) {
        return undefined
      }
      const timeout = typeof options === 'number' ? options : (options?.timeout ?? 30_000)
      return await new Promise<undefined>((resolve, reject) => {
        const timer = setTimeout(() => {
          events.off('close', onClose)
          reject(new Error(`[e2e-web] Timed out waiting for electronApp 'close' (${timeout}ms)`))
        }, timeout)
        const onClose = () => {
          clearTimeout(timer)
          resolve(undefined)
        }
        events.once('close', onClose)
      })
    },
  }

  const proxy = strictRecord('electronApp', members)
  return proxy as unknown as ElectronApplication
}

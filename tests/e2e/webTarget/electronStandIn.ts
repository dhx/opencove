import type { ElectronApplication } from '@playwright/test'

export const ELECTRON_ONLY_MESSAGE = 'Electron-only (OPENCOVE_E2E_TARGET=web)'

// What `launchApp()` hands back as `electronApp` in web mode: `close()` stops the worker and the
// browser; everything else is the Electron main process, which the web target does not have.
export function createElectronStandIn(close: () => Promise<void>): ElectronApplication {
  const members: Record<PropertyKey, unknown> = { close }
  return new Proxy(members, {
    get(target, property) {
      if (property in target) {
        return target[property]
      }

      // Probes by `await`, util.inspect, JSON and the like must not throw.
      if (typeof property === 'symbol' || property === 'then' || property === 'toJSON') {
        return undefined
      }

      throw new Error(`${ELECTRON_ONLY_MESSAGE}: electronApp.${String(property)} is not available`)
    },
  }) as unknown as ElectronApplication
}

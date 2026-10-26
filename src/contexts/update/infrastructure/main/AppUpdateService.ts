import { app, BrowserWindow } from 'electron'
import type {
  AppUpdateChannel,
  AppUpdatePolicy,
  AppUpdateState,
  AppUpdateStatus,
  ConfigureAppUpdatesInput,
} from '../../../../shared/contracts/dto'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'

const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 6

type DriverDisposer = () => void

// The fields this service reads from an updater's events (the shape electron-updater used to report).
interface UpdateInfo {
  version?: string | null
  releaseName?: string | null
  releaseDate?: string | Date | null
}
type UpdateDownloadedEvent = UpdateInfo
interface ProgressInfo {
  percent: number
  transferred: number
  total: number
}

interface AppUpdateDriver {
  configure(options: {
    autoDownload: boolean
    autoInstallOnAppQuit: boolean
    allowPrerelease: boolean
    channel: string
  }): void
  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  quitAndInstall(): void
  onCheckingForUpdate(listener: () => void): DriverDisposer
  onUpdateAvailable(listener: (info: UpdateInfo) => void): DriverDisposer
  onUpdateNotAvailable(listener: (info: UpdateInfo) => void): DriverDisposer
  onDownloadProgress(listener: (progress: ProgressInfo) => void): DriverDisposer
  onUpdateDownloaded(listener: (info: UpdateDownloadedEvent) => void): DriverDisposer
  onError(listener: (error: Error) => void): DriverDisposer
}

export interface AppUpdateService {
  getState(): AppUpdateState
  configure(input: ConfigureAppUpdatesInput): Promise<AppUpdateState>
  checkForUpdates(): Promise<AppUpdateState>
  downloadUpdate(): Promise<AppUpdateState>
  installUpdate(): Promise<void>
  dispose(): void
}

interface AppUpdateServiceOptions {
  supportsUpdates?: boolean
  unsupportedMessage?: string
}

function channelToUpdaterChannel(channel: AppUpdateChannel): string {
  return channel === 'nightly' ? 'nightly' : 'latest'
}

function buildBaseState(
  currentVersion: string,
  policy: AppUpdatePolicy,
  channel: AppUpdateChannel,
  status: AppUpdateStatus,
  message: string | null = null,
): AppUpdateState {
  return {
    policy,
    channel,
    currentVersion,
    status,
    latestVersion: null,
    releaseName: null,
    releaseDate: null,
    releaseNotesUrl: null,
    downloadPercent: null,
    downloadedBytes: null,
    totalBytes: null,
    checkedAt: null,
    message,
  }
}

function normalizeReleaseDate(value: string | Date | null | undefined): string | null {
  if (value instanceof Date) {
    return value.toISOString()
  }

  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripErrorPrefixes(value: string): string {
  let normalized = value.trim()

  while (/^[A-Za-z0-9_.-]*Error:\s*/.test(normalized)) {
    normalized = normalized.replace(/^[A-Za-z0-9_.-]*Error:\s*/, '').trim()
  }

  return normalized
}

function extractPrimaryMessage(value: string): string {
  const firstLine = value.split(/\r?\n/, 1)[0] ?? value
  return normalizeWhitespace(stripErrorPrefixes(firstLine))
}

function summarizeUpdateErrorMessage(message: string): string {
  const normalized = normalizeWhitespace(message)

  if (normalized.includes('Cannot parse releases feed')) {
    return 'Unable to read the update feed from GitHub Releases.'
  }

  if (
    normalized.includes('Code signature at URL') &&
    normalized.includes('did not pass validation')
  ) {
    return 'macOS rejected the downloaded update because its code signature did not match this build. Download the latest release manually.（macOS 因签名不匹配拒绝安装更新，请手动下载安装最新版本。）'
  }

  if (
    normalized.includes('net::ERR_INTERNET_DISCONNECTED') ||
    normalized.includes('net::ERR_NETWORK_CHANGED')
  ) {
    return 'Network connection was interrupted while checking for updates.'
  }

  const primary = extractPrimaryMessage(normalized)
  if (primary.length <= 160) {
    return primary
  }

  return `${primary.slice(0, 157).trimEnd()}...`
}

function normalizeMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return summarizeUpdateErrorMessage(error.message)
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return summarizeUpdateErrorMessage(error)
  }

  return 'Unknown update error'
}

// This fork's builds never check for updates on their own: there is no update feed, and the updater
// (electron-updater against GitHub Releases) is not wired in. New versions come from our own releases.
export const APP_UPDATES_OFF_MESSAGE = 'Automatic updates are off in this build.'

function createNoopAppUpdateDriver(): AppUpdateDriver {
  const noListener = (): DriverDisposer => () => undefined
  return {
    configure() {},
    async checkForUpdates() {},
    async downloadUpdate() {},
    quitAndInstall() {},
    onCheckingForUpdate: noListener,
    onUpdateAvailable: noListener,
    onUpdateNotAvailable: noListener,
    onDownloadProgress: noListener,
    onUpdateDownloaded: noListener,
    onError: noListener,
  }
}

export function createAppUpdateService(
  driver: AppUpdateDriver = createNoopAppUpdateDriver(),
  options: AppUpdateServiceOptions = {},
): AppUpdateService {
  const currentVersion = app.getVersion()
  const supportsUpdates = options.supportsUpdates ?? false
  const unsupportedMessage = options.unsupportedMessage ?? APP_UPDATES_OFF_MESSAGE

  let state = buildBaseState(
    currentVersion,
    'off',
    'stable',
    supportsUpdates ? 'idle' : 'unsupported',
    supportsUpdates ? null : unsupportedMessage,
  )
  let intervalId: ReturnType<typeof setInterval> | null = null
  let activeCheckPromise: Promise<void> | null = null
  let activeDownloadPromise: Promise<void> | null = null

  const emitState = (): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.appUpdateState, state)
    }
  }

  const applyState = (nextState: AppUpdateState): AppUpdateState => {
    state = nextState
    emitState()
    return state
  }

  const clearSchedule = (): void => {
    if (!intervalId) {
      return
    }

    clearInterval(intervalId)
    intervalId = null
  }

  const resetConfiguredState = (status: AppUpdateStatus, message: string | null = null): void => {
    applyState(buildBaseState(currentVersion, state.policy, state.channel, status, message))
  }

  const scheduleChecks = (): void => {
    clearSchedule()
    if (!supportsUpdates || state.policy === 'off') {
      return
    }

    intervalId = setInterval(() => {
      void service.checkForUpdates()
    }, UPDATE_CHECK_INTERVAL_MS)
  }

  const driverDisposers = [
    driver.onCheckingForUpdate(() => {
      applyState({
        ...buildBaseState(currentVersion, state.policy, state.channel, 'checking'),
        checkedAt: state.checkedAt,
      })
    }),
    driver.onUpdateAvailable(info => {
      applyState({
        ...buildBaseState(currentVersion, state.policy, state.channel, 'available'),
        latestVersion: info.version ?? null,
        releaseName: info.releaseName ?? null,
        releaseDate: normalizeReleaseDate(info.releaseDate),
        checkedAt: new Date().toISOString(),
      })
    }),
    driver.onUpdateNotAvailable(_info => {
      applyState({
        ...buildBaseState(currentVersion, state.policy, state.channel, 'up_to_date'),
        checkedAt: new Date().toISOString(),
      })
    }),
    driver.onDownloadProgress(progress => {
      applyState({
        ...state,
        status: 'downloading',
        downloadPercent: Number.isFinite(progress.percent) ? progress.percent : null,
        downloadedBytes: Number.isFinite(progress.transferred) ? progress.transferred : null,
        totalBytes: Number.isFinite(progress.total) ? progress.total : null,
      })
    }),
    driver.onUpdateDownloaded(info => {
      applyState({
        ...state,
        status: 'downloaded',
        latestVersion: info.version ?? state.latestVersion,
        releaseName: info.releaseName ?? state.releaseName,
        releaseDate: normalizeReleaseDate(info.releaseDate) ?? state.releaseDate,
        downloadPercent: 100,
        downloadedBytes: state.totalBytes,
        checkedAt: new Date().toISOString(),
      })
    }),
    driver.onError(error => {
      applyState({
        ...buildBaseState(
          currentVersion,
          state.policy,
          state.channel,
          'error',
          normalizeMessage(error),
        ),
        checkedAt: new Date().toISOString(),
        latestVersion: state.latestVersion,
        releaseName: state.releaseName,
        releaseDate: state.releaseDate,
      })
    }),
  ]

  const service: AppUpdateService = {
    getState() {
      return state
    },
    async configure(input) {
      const normalizedPolicy =
        input.channel === 'nightly' && input.policy === 'auto' ? 'prompt' : input.policy
      state = {
        ...state,
        policy: normalizedPolicy,
        channel: input.channel,
      }

      clearSchedule()

      if (!supportsUpdates) {
        return applyState({
          ...buildBaseState(
            currentVersion,
            input.policy,
            input.channel,
            'unsupported',
            unsupportedMessage,
          ),
        })
      }

      if (normalizedPolicy === 'off') {
        return applyState(
          buildBaseState(currentVersion, normalizedPolicy, input.channel, 'disabled'),
        )
      }

      driver.configure({
        autoDownload: normalizedPolicy === 'auto',
        autoInstallOnAppQuit: normalizedPolicy === 'auto',
        allowPrerelease: input.channel === 'nightly',
        channel: channelToUpdaterChannel(input.channel),
      })

      resetConfiguredState('idle')
      scheduleChecks()
      void service.checkForUpdates()
      return state
    },
    async checkForUpdates() {
      if (!supportsUpdates) {
        return state
      }

      if (state.policy === 'off' || state.status === 'downloaded') {
        return state
      }

      if (activeCheckPromise) {
        await activeCheckPromise
        return state
      }

      activeCheckPromise = driver.checkForUpdates().finally(() => {
        activeCheckPromise = null
      })

      await activeCheckPromise
      return state
    },
    async downloadUpdate() {
      if (!supportsUpdates) {
        return state
      }

      if (state.status !== 'available') {
        return state
      }

      if (activeDownloadPromise) {
        await activeDownloadPromise
        return state
      }

      applyState({
        ...state,
        status: 'downloading',
        downloadPercent: 0,
        downloadedBytes: 0,
        totalBytes: null,
      })

      activeDownloadPromise = driver.downloadUpdate().finally(() => {
        activeDownloadPromise = null
      })

      await activeDownloadPromise
      return state
    },
    async installUpdate() {
      if (state.status !== 'downloaded') {
        return
      }

      driver.quitAndInstall()
    },
    dispose() {
      clearSchedule()
      for (const dispose of driverDisposers) {
        dispose()
      }
    },
  }

  return service
}

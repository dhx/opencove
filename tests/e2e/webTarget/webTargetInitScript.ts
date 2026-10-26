// Runs in the page before the Web UI boots. The Web UI installs `window.opencoveApi` itself
// (src/app/renderer/browser/browserOpenCoveApi.ts); this wraps that assignment so the page reports
// what Electron's preload reports under `NODE_ENV=test` (src/app/preload/opencoveMeta.ts), and so the
// workspace picker answers like the desktop test stub does (OPENCOVE_TEST_WORKSPACE).

export interface WebTargetInitScriptArgs {
  meta: Record<string, unknown>
  testWorkspacePath: string | null
}

export function resolveWebTargetInitScriptArgs(
  env: Record<string, string>,
): WebTargetInitScriptArgs {
  const isTest = env['NODE_ENV'] === 'test'
  return {
    meta: {
      isTest,
      allowWhatsNewInTests: env['OPENCOVE_TEST_WHATS_NEW'] === '1',
      enableTerminalDiagnostics: env['OPENCOVE_TERMINAL_DIAGNOSTICS'] === '1',
      enableTerminalInputDiagnostics: env['OPENCOVE_TERMINAL_INPUT_DIAGNOSTICS'] === '1',
      enableTerminalTestApi: env['OPENCOVE_TERMINAL_TEST_API'] === '1',
      disableTerminalTranscriptMirror: env['OPENCOVE_DISABLE_TERMINAL_TRANSCRIPT_MIRROR'] === '1',
      enableUiGallery: isTest && env['OPENCOVE_TEST_UI_GALLERY'] === '1',
    },
    testWorkspacePath: isTest ? (env['OPENCOVE_TEST_WORKSPACE'] ?? null) : null,
  }
}

export function webTargetInitScript(args: WebTargetInitScriptArgs): void {
  const target = window as unknown as Record<string, unknown>
  let installedApi: unknown = undefined

  const adapt = (api: unknown): unknown => {
    if (!api || typeof api !== 'object') {
      return api
    }

    const record = api as {
      meta?: Record<string, unknown>
      workspace?: Record<string, unknown>
    }
    if (record.meta) {
      Object.assign(record.meta, args.meta)
    }

    const testWorkspacePath = args.testWorkspacePath
    if (record.workspace && testWorkspacePath) {
      const segments = testWorkspacePath.split(/[\\/]+/).filter(segment => segment.length > 0)
      record.workspace.selectDirectory = async () => ({
        id: crypto.randomUUID(),
        name: segments[segments.length - 1] ?? testWorkspacePath,
        path: testWorkspacePath,
      })
    }

    return api
  }

  Object.defineProperty(target, 'opencoveApi', {
    configurable: true,
    enumerable: true,
    get: () => installedApi,
    set: value => {
      installedApi = adapt(value)
    },
  })
}

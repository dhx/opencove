// Tests of the Electron E2E suite that the web target (OPENCOVE_E2E_TARGET=web,
// playwright.e2e-web.config.ts) does not run. Each entry names the spec file (relative to tests/e2e)
// and, optionally, one test title in it (no title = the whole file). Kept honest by
// tests/unit/e2e/webTargetSkips.spec.ts, which fails when a file or title no longer exists.
//
// Categories:
// - electron-only: the test drives the Electron main process, native dialogs/menus, BrowserWindow,
//   desktop restart semantics or OS integration that the Web UI does not have.
// - electron-native-input: relies on Electron's clipboard/nativeImage or native file paths for input
//   (image paste, OS file drop); the Web UI's own path is covered by a web test in tests/e2e-web-canvas.
// - desktop-only-feature: a feature the Web UI does not offer by decision (e.g. the issue report).
// - web-ui-bug: a real difference in the Web UI that should be fixed there (listed in RELEASES.md).
// - known-failing: fails in web mode for a reason not yet sorted out.

export type WebTargetSkipCategory =
  | 'electron-only'
  | 'electron-native-input'
  | 'desktop-only-feature'
  | 'web-ui-bug'
  | 'known-failing'

export interface WebTargetSkip {
  file: string
  title?: string
  category: WebTargetSkipCategory
  reason: string
}

export const webTargetSkips: WebTargetSkip[] = []

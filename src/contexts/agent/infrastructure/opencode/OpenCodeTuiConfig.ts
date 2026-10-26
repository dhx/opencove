import {
  createTemporaryProviderConfig,
  type TemporaryProviderConfig,
} from '../providers/shared/TemporaryProviderConfig'

export const OPENCODE_EMBEDDED_TUI_CONFIG_CONTENTS = `${JSON.stringify(
  {
    $schema: 'https://opencode.ai/tui.json',
    theme: 'system',
  },
  null,
  2,
)}\n`

/**
 * Writes the embedded OpenCode TUI config into a fresh private temp directory (0700, file 0600)
 * instead of a fixed, guessable path in the shared temp dir. The caller owns the returned artifact
 * and disposes it with the launch, like the other temporary provider configs.
 */
export async function createOpenCodeEmbeddedTuiConfig(): Promise<TemporaryProviderConfig> {
  return await createTemporaryProviderConfig(
    'opencove-opencode-tui-',
    'tui.json',
    OPENCODE_EMBEDDED_TUI_CONFIG_CONTENTS,
  )
}

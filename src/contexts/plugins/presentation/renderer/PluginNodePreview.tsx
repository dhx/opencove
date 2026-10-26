import type { JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { usePluginManifest } from './usePluginRegistry'
import { PluginRuntimePreview } from './PluginRuntimePreview'

/** Only a declared, independently installed preview may start a preview runtime. */
export function PluginNodePreview({ pluginId }: { pluginId: string }): JSX.Element {
  const { t } = useTranslation()
  const plugin = usePluginManifest(pluginId)
  if (plugin?.source !== 'local' || !plugin.hasPreview) {
    return <p>{t('settingsPanel.plugins.preview.unavailable')}</p>
  }
  // A preview runs the plugin's code, so the host serves it only for an enabled plugin.
  return plugin.enabled ? (
    <PluginRuntimePreview key={plugin.id} plugin={plugin} />
  ) : (
    <p>{t('settingsPanel.plugins.preview.enableToPreview')}</p>
  )
}

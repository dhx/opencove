import React from 'react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { listVoiceBossAgents } from './bossChannel'
import { useVoiceAssistant } from './useVoiceAssistant'
import { VoiceHoldButton } from './VoiceHoldButton'
import { VoiceIndicator } from './VoiceIndicator'

export function VoiceAssistant({
  settings,
}: {
  settings: Pick<AgentSettings, 'voice' | 'keybindings'>
}): React.JSX.Element | null {
  const { enabled, turn, engine, hold } = useVoiceAssistant(settings)
  const bossNodeId = settings.voice.bossNodeId
  const bossTitle = useAppStore(state =>
    bossNodeId
      ? (listVoiceBossAgents(state.workspaces).find(agent => agent.nodeId === bossNodeId)?.title ??
        '')
      : '',
  )

  if (!enabled) {
    return null
  }
  return (
    <>
      <VoiceIndicator turn={turn} engine={engine} bossTitle={bossTitle} />
      {hold && bossTitle ? <VoiceHoldButton hold={hold} turn={turn} bossTitle={bossTitle} /> : null}
    </>
  )
}

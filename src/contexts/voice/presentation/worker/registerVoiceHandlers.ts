import type { ControlSurface } from '../../../../app/main/controlSurface/controlSurface'
import type { VoiceEngineStatus } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import { VoiceModelsMissingError } from '../../application/VoiceEngine'
import type { VoiceService } from '../../application/VoiceService'

function normalizeNoPayload(id: string): (payload: unknown) => null {
  return payload => {
    if (payload !== null && payload !== undefined) {
      throw createAppError('common.invalid_input', { debugMessage: `Invalid payload for ${id}.` })
    }
    return null
  }
}

/**
 * The engine's load state over the control surface. Speech itself does not go through here: audio
 * is too large for /invoke's JSON envelope and has its own routes under /voice/.
 */
export function registerVoiceHandlers(
  controlSurface: ControlSurface,
  deps: { service: VoiceService },
): void {
  controlSurface.register('voice.status', {
    kind: 'query',
    validate: normalizeNoPayload('voice.status'),
    handle: (): VoiceEngineStatus => deps.service.getStatus(),
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('voice.prepare', {
    kind: 'command',
    validate: normalizeNoPayload('voice.prepare'),
    handle: async (): Promise<VoiceEngineStatus> => {
      try {
        await deps.service.prepare()
      } catch (error) {
        if (error instanceof VoiceModelsMissingError) {
          throw createAppError('voice.models_missing', { debugMessage: error.message })
        }
        throw error
      }
      return deps.service.getStatus()
    },
    defaultErrorCode: 'voice.prepare_failed',
  })
}

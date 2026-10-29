import type { ControlSurface } from '../../../../app/main/controlSurface/controlSurface'
import type { VoiceEngine } from '../../application/VoiceEngine'
import { VoiceService } from '../../application/VoiceService'
import { forkVoiceHost } from '../../infrastructure/localEngine/forkVoiceHost'
import { LocalVoiceEngine } from '../../infrastructure/localEngine/LocalVoiceEngine'
import { StubVoiceEngine } from '../../infrastructure/stubEngine/StubVoiceEngine'
import { registerVoiceHandlers } from './registerVoiceHandlers'

export interface WorkerVoiceRuntime {
  service: VoiceService
  registerHandlers(controlSurface: ControlSurface): void
  dispose(): Promise<void>
}

/**
 * `OPENCOVE_VOICE_MODELS_DIR` is where the image put the models. Without it, voice reports
 * `voice.models_missing` on first use and nothing else changes.
 */
export function createWorkerVoiceEngine(options: {
  env: NodeJS.ProcessEnv
  reportIssue: (message: string) => void
}): VoiceEngine {
  if (options.env.OPENCOVE_TEST_VOICE_ENGINE === 'stub') {
    return new StubVoiceEngine({ transcript: options.env.OPENCOVE_TEST_VOICE_TRANSCRIPT })
  }
  return new LocalVoiceEngine({
    modelsDir: options.env.OPENCOVE_VOICE_MODELS_DIR?.trim() ?? '',
    createProcess: () => forkVoiceHost({ baseDir: __dirname, env: options.env }),
    reportIssue: options.reportIssue,
  })
}

/** One voice service per worker. The model process starts on first use, not with the worker. */
export function createWorkerVoiceRuntime(options: {
  env: NodeJS.ProcessEnv
  reportIssue: (message: string) => void
}): WorkerVoiceRuntime {
  const service = new VoiceService(createWorkerVoiceEngine(options))
  return {
    service,
    registerHandlers: controlSurface => registerVoiceHandlers(controlSurface, { service }),
    dispose: () => service.dispose(),
  }
}

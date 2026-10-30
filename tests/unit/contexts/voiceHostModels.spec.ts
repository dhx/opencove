import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env, pipeline } from '@huggingface/transformers'
import { VoiceModelsMissingError } from '../../../src/contexts/voice/application/VoiceEngine'
import {
  configureOfflineTransformers,
  findMissingVoiceModels,
  loadVoiceModels,
} from '../../../src/contexts/voice/infrastructure/localEngine/voiceHostModels'
import {
  KOKORO_MODEL_ID,
  WHISPER_MODEL_ID,
} from '../../../src/contexts/voice/infrastructure/localEngine/voiceHostProtocol'

// kokoro-js is never imported here: its phonemizer installs a process-wide unhandledRejection
// handler that rethrows, which would take the test worker down with any stray rejection.

let modelsDir: string

beforeEach(async () => {
  modelsDir = await mkdtemp(join(tmpdir(), 'voice-models-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(modelsDir, { recursive: true, force: true })
})

async function addModel(id: string): Promise<void> {
  await mkdir(join(modelsDir, id), { recursive: true })
  await writeFile(join(modelsDir, id, 'config.json'), '{}')
}

describe('voice models on disk', () => {
  it('names every model that has no config in the models directory', async () => {
    await addModel(WHISPER_MODEL_ID)

    expect(findMissingVoiceModels(modelsDir)).toEqual([KOKORO_MODEL_ID])
  })

  it('refuses to load without models, before touching any model library', async () => {
    await expect(loadVoiceModels(modelsDir, () => {})).rejects.toBeInstanceOf(
      VoiceModelsMissingError,
    )
  })

  it('refuses to load when no models directory is configured', async () => {
    await expect(loadVoiceModels('', () => {})).rejects.toBeInstanceOf(VoiceModelsMissingError)
  })
})

describe('offline transformers', () => {
  it('turns remote models off and reads only the models directory', () => {
    configureOfflineTransformers(env, modelsDir)

    expect(env.allowRemoteModels).toBe(false)
    expect(env.allowLocalModels).toBe(true)
    expect(env.localModelPath).toBe(modelsDir)
    expect(env.useFSCache).toBe(false)
  })

  it('makes a request for a model that is not on disk throw without any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    configureOfflineTransformers(env, modelsDir)

    await expect(
      pipeline('automatic-speech-recognition', WHISPER_MODEL_ID, { dtype: 'q8' }),
    ).rejects.toThrow(/allowRemoteModels=false|local_files_only/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

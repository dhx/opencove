import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join } from 'node:path'
import { VoiceModelsMissingError } from '../../application/VoiceEngine'
import type { KokoroVoiceId } from '../../domain/voiceSettings'
import { createDownloadProgressTracker } from './downloadProgress'
import type { VoiceModelLoader } from './voiceHostHandler'
import { KOKORO_DTYPE, KOKORO_MODEL_ID, WHISPER_DTYPE, WHISPER_MODEL_ID } from './voiceHostProtocol'

const VOICE_MODEL_IDS = [WHISPER_MODEL_ID, KOKORO_MODEL_ID] as const

/** The part of transformers.js's `env` that decides where models come from. */
interface TransformersModelEnv {
  allowRemoteModels: boolean
  allowLocalModels: boolean
  localModelPath: string
  useFSCache: boolean
}

/**
 * Models come only from `modelsDir`, which the image fills at build time. With remote models off,
 * a model that is not on disk throws instead of being fetched, and with the file cache off nothing
 * is written into the (read-only) package folder.
 */
export function configureOfflineTransformers(env: TransformersModelEnv, modelsDir: string): void {
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = modelsDir
  env.useFSCache = false
}

/** Ids of the models whose folder under `modelsDir` has no `config.json`. */
export function findMissingVoiceModels(modelsDir: string): string[] {
  return VOICE_MODEL_IDS.filter(id => !existsSync(join(modelsDir, id, 'config.json')))
}

/**
 * Loads Whisper and Kokoro on onnxruntime-node. Runs only inside the voice host process.
 *
 * The libraries are imported here, after the models are known to exist, rather than at the top:
 * kokoro-js's phonemizer installs a process-wide `unhandledRejection` handler that rethrows, and
 * nothing that merely checks for models should carry that.
 */
export const loadVoiceModels: VoiceModelLoader = async (modelsDir, onProgress) => {
  if (!modelsDir || !isAbsolute(modelsDir)) {
    throw new VoiceModelsMissingError('No voice models directory is configured on this server.')
  }
  const missing = findMissingVoiceModels(modelsDir)
  if (missing.length > 0) {
    throw new VoiceModelsMissingError(`Voice models missing in ${modelsDir}: ${missing.join(', ')}`)
  }

  const { env, pipeline } = await import('@huggingface/transformers')
  configureOfflineTransformers(env, modelsDir)
  // transformers ships an ESM and a CJS build, and each is its own module instance with its own
  // `env`. kokoro-js gets whichever its own format asks for, and the bundler may turn the import
  // above into a require. Configuring both keeps the offline rule independent of either choice.
  const requireFromHere = createRequire(__filename)
  configureOfflineTransformers(requireFromHere('@huggingface/transformers').env, modelsDir)
  const { KokoroTTS } = await import('kokoro-js')

  const progress_callback = createDownloadProgressTracker(onProgress)

  const [tts, asr] = await Promise.all([
    KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
      dtype: KOKORO_DTYPE,
      device: 'cpu',
      progress_callback,
    }),
    pipeline('automatic-speech-recognition', WHISPER_MODEL_ID, {
      dtype: WHISPER_DTYPE,
      device: 'cpu',
      progress_callback,
    }),
  ])

  return {
    transcribe: async pcm16k => {
      const output = await asr(pcm16k)
      return (Array.isArray(output) ? output : [output]).map(part => part.text).join(' ')
    },
    synthesize: async (text, voice) => {
      const audio = await tts.generate(text, { voice: voice as KokoroVoiceId })
      return { samples: audio.audio, sampleRate: audio.sampling_rate }
    },
  }
}

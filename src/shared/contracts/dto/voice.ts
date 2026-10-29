/** Model loading state of the voice engine, owned by the worker. */
export type VoiceEngineStatus =
  | { state: 'idle' }
  /** progress is 0..1 across loading the local model files, or null until a file reports bytes. */
  | { state: 'loading'; progress: number | null }
  | { state: 'ready' }
  /** `models_missing`: this server has no voice models, so voice is not installed here. */
  | { state: 'error'; message: string; reason?: 'models_missing' }

export interface VoiceTranscribeInput {
  /** Mono PCM at 16 kHz, samples in -1..1. */
  pcm16k: Float32Array
}

export interface VoiceTranscribeResult {
  text: string
}

export interface VoiceSpeakInput {
  /** Chosen by the caller so it can match chunk events and cancel. */
  requestId: string
  text: string
  voice: string
}

export interface VoiceSpeakResult {
  chunkCount: number
  cancelled: boolean
}

export interface VoiceCancelSpeakInput {
  requestId: string
}

/** One sentence of speech for the request that asked for it, in order. */
export interface VoiceSpeakChunkEvent {
  requestId: string
  index: number
  sampleRate: number
  samples: Float32Array
}

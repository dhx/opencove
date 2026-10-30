/** Model loading state of the voice engine, owned by the worker. */
export type VoiceEngineStatus =
  | { state: 'idle' }
  /** progress is 0..1 across loading the local model files, or null until a file reports bytes. */
  | { state: 'loading'; progress: number | null }
  | { state: 'ready' }
  /** `models_missing`: this server has no voice models, so voice is not installed here. */
  | { state: 'error'; message: string; reason?: 'models_missing' }

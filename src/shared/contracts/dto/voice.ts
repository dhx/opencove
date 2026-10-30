/** Model loading state of the voice engine, owned by the worker. */
export type VoiceEngineStatus =
  | { state: 'idle' }
  /** progress is 0..1 across loading the local model files, or null until a file reports bytes. */
  | { state: 'loading'; progress: number | null }
  | { state: 'ready' }
  | { state: 'error'; message: string }

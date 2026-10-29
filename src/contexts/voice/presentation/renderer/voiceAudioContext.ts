let sharedContext: AudioContext | null = null

/**
 * The one AudioContext voice records and plays through.
 *
 * iOS starts a context suspended unless it is created or resumed inside a user gesture, and the
 * reply plays long after the press, outside any gesture. So the press handler calls this first,
 * synchronously, and the player later reuses the context it unlocked.
 */
export function unlockVoiceAudio(): AudioContext {
  if (!sharedContext || sharedContext.state === 'closed') {
    sharedContext = new AudioContext()
  }
  if (sharedContext.state === 'suspended') {
    void sharedContext.resume().catch(() => undefined)
  }
  return sharedContext
}

/** The context for playback; creates one when no press unlocked it yet (desktop browsers allow that). */
export function getVoiceAudioContext(): AudioContext {
  return sharedContext && sharedContext.state !== 'closed' ? sharedContext : unlockVoiceAudio()
}

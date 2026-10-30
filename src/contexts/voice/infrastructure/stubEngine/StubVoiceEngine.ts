import type {
  VoiceAudioChunk,
  VoiceEngine,
  VoiceModelProgress,
} from '../../application/VoiceEngine'
import type { KokoroVoiceId } from '../../domain/voiceSettings'
import { chunkForSpeech } from '../../domain/voiceText'

const STUB_SAMPLE_RATE = 24000

/**
 * A voice engine without models, for end-to-end tests (`OPENCOVE_TEST_VOICE_ENGINE=stub`). It
 * answers every recording with a fixed transcript and speaks each sentence as a short tone, so the
 * whole path from button to speaker runs without Whisper or Kokoro.
 */
export class StubVoiceEngine implements VoiceEngine {
  public readonly id = 'local' as const
  private readonly transcript: string

  public constructor(options: { transcript?: string } = {}) {
    this.transcript = options.transcript ?? 'stub transcript'
  }

  public async prepare(onProgress: (progress: VoiceModelProgress) => void): Promise<void> {
    onProgress({ progress: 1 })
  }

  public async transcribe(_pcm16k: Float32Array): Promise<string> {
    return this.transcript
  }

  public async *speak(
    text: string,
    _voice: KokoroVoiceId,
    signal: AbortSignal,
  ): AsyncGenerator<VoiceAudioChunk> {
    let index = 0
    for (const sentence of chunkForSpeech(text)) {
      if (signal.aborted) {
        return
      }
      yield { index, sampleRate: STUB_SAMPLE_RATE, samples: createTone(sentence.length) }
      index += 1
    }
  }

  public onUnavailable(): () => void {
    return () => {}
  }

  public async dispose(): Promise<void> {}
}

/** A quiet 440 Hz tone, 20 ms per character, so longer sentences play longer. */
function createTone(characters: number): Float32Array {
  const samples = new Float32Array(Math.max(1, characters) * (STUB_SAMPLE_RATE / 50))
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = 0.1 * Math.sin((2 * Math.PI * 440 * index) / STUB_SAMPLE_RATE)
  }
  return samples
}

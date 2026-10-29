// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { VoiceEngine } from '../../../src/contexts/voice/application/VoiceEngine'
import { VoiceRequestGate } from '../../../src/contexts/voice/application/VoiceRequestGate'
import { VoiceService } from '../../../src/contexts/voice/application/VoiceService'
import { handleVoiceRoute } from '../../../src/contexts/voice/presentation/worker/voiceRoutes'

let server: Server | null = null

afterEach(async () => {
  await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()))
  server = null
})

async function serve(engine: VoiceEngine, gate: VoiceRequestGate): Promise<string> {
  const service = new VoiceService(engine)
  server = createServer((req, res) => {
    void handleVoiceRoute({
      req,
      res,
      pathname: new URL(req.url!, 'http://x').pathname,
      service,
      gate,
    })
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
}

function engineWith(speak: VoiceEngine['speak']): VoiceEngine {
  return {
    id: 'local',
    prepare: async () => {},
    transcribe: async () => 'heard',
    speak,
    onUnavailable: () => () => {},
    dispose: async () => {},
  }
}

describe('voice routes', () => {
  it('answers voice.busy to another tab while one tab is in a turn', async () => {
    const gate = new VoiceRequestGate()
    const origin = await serve(
      engineWith(async function* () {}),
      gate,
    )
    let release!: () => void
    const held = gate.run('tab-2', () => new Promise<void>(resolve => (release = resolve)))

    const response = await fetch(`${origin}/voice/transcribe`, {
      method: 'POST',
      headers: { 'x-opencove-voice-client': 'tab-1' },
      body: new Uint8Array(4),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'voice.busy' } })
    release()
    await held
  })

  it('stops synthesis when the browser drops the stream', async () => {
    let signalSeen: AbortSignal | null = null
    let sentences = 0
    const origin = await serve(
      engineWith(async function* (_text, _voice, signal) {
        signalSeen = signal
        while (!signal.aborted && sentences < 1000) {
          sentences += 1
          yield { index: sentences, sampleRate: 24000, samples: new Float32Array(24000) }
          // eslint-disable-next-line no-await-in-loop -- A slow engine: one sentence at a time.
          await new Promise(resolve => setTimeout(resolve, 5))
        }
      }),
      new VoiceRequestGate(),
    )
    const controller = new AbortController()
    const response = await fetch(`${origin}/voice/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Long reply.', voice: 'af_heart' }),
      signal: controller.signal,
    })
    const reader = response.body!.getReader()
    await reader.read()

    controller.abort()
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(signalSeen!.aborted).toBe(true)
    const stoppedAt = sentences
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(sentences).toBe(stoppedAt)
    expect(stoppedAt).toBeLessThan(1000)
  })
})

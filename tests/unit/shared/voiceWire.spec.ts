import { describe, expect, it } from 'vitest'
import {
  SPEECH_FRAME_HEADER_BYTES,
  SpeechFrameDecoder,
  encodePcm16,
  encodeSpeechFrame,
} from '../../../src/shared/voice/voiceWire'

describe('PCM encoding', () => {
  it('turns samples in -1..1 into little-endian Int16, clamped', () => {
    const bytes = new DataView(encodePcm16(new Float32Array([0, 0.5, -1, 2, -2])).buffer)

    expect([0, 1, 2, 3, 4].map(index => bytes.getInt16(index * 2, true))).toEqual([
      0, 16383, -32768, 32767, -32768,
    ])
  })
})

describe('speech frames', () => {
  const frame = (sequence: number, samples: number[]) =>
    encodeSpeechFrame({ sampleRate: 24000, samples: new Float32Array(samples) }, sequence)

  it('lays a frame out as sample rate, count and sequence, then the samples', () => {
    const bytes = frame(7, [0.25, -0.5])
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    expect(bytes.byteLength).toBe(SPEECH_FRAME_HEADER_BYTES + 8)
    expect([view.getUint32(0, true), view.getUint32(4, true), view.getUint32(8, true)]).toEqual([
      24000, 2, 7,
    ])
    expect(view.getFloat32(12, true)).toBe(0.25)
  })

  it('decodes frames however the stream happens to be cut', () => {
    const stream = new Uint8Array([...frame(0, [0.1, 0.2, 0.3]), ...frame(1, [0.4])])

    for (let cut = 1; cut < stream.length; cut += 1) {
      const decoder = new SpeechFrameDecoder()
      const frames = [
        ...decoder.push(stream.subarray(0, cut)),
        ...decoder.push(stream.subarray(cut)),
      ]

      expect(frames.map(decoded => decoded.sequence)).toEqual([0, 1])
      expect(Array.from(frames[0].samples)).toEqual(Array.from(new Float32Array([0.1, 0.2, 0.3])))
      expect(decoder.hasPartialFrame()).toBe(false)
    }
  })

  it('tells when the stream ended inside a frame', () => {
    const decoder = new SpeechFrameDecoder()
    decoder.push(frame(0, [0.1, 0.2]).subarray(0, 14))

    expect(decoder.hasPartialFrame()).toBe(true)
  })

  it('refuses an absurd sample count instead of buffering it', () => {
    const header = new Uint8Array(SPEECH_FRAME_HEADER_BYTES)
    const view = new DataView(header.buffer)
    view.setUint32(0, 24000, true)
    view.setUint32(4, 0xffffffff, true)

    expect(() => new SpeechFrameDecoder().push(header)).toThrow(/frame/)
  })
})

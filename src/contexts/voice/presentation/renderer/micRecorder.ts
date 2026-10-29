import captureWorkletUrl from './voiceCaptureWorklet.ts?worker&url'

const WHISPER_SAMPLE_RATE = 16_000
const CAPTURE_PROCESSOR = 'opencove-voice-capture'

export interface MicRecorder {
  start(): Promise<void>
  /** Stops recording and returns mono PCM at 16 kHz; empty when the mic never delivered audio. */
  stop(): Promise<Float32Array>
  cancel(): void
}

interface Capture {
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  node: AudioWorkletNode
  sink: GainNode
  frames: Float32Array[]
}

interface RecordingSession {
  ready: Promise<Capture | null>
  cancelled: boolean
}

const loadedModules = new WeakSet<AudioContext>()

async function ensureCaptureModule(context: AudioContext): Promise<void> {
  if (loadedModules.has(context)) {
    return
  }
  // Served from the Web UI's own origin, which `script-src 'self'` allows; a blob: module would not.
  await context.audioWorklet.addModule(captureWorkletUrl)
  loadedModules.add(context)
}

function release(capture: Capture): void {
  capture.source.disconnect()
  capture.node.disconnect()
  capture.sink.disconnect()
  capture.node.port.onmessage = null
  for (const track of capture.stream.getTracks()) {
    track.stop()
  }
}

/**
 * Records through an AudioWorklet, which every browser with getUserMedia has (Safari and Firefox
 * lack MediaStreamTrackProcessor). The microphone is open only between start and stop or cancel,
 * and nothing is written anywhere but memory.
 */
async function openCapture(
  context: AudioContext,
  isCancelled: () => boolean,
): Promise<Capture | null> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  })
  // A cancel can land while getUserMedia or the module load is still pending.
  if (isCancelled()) {
    stream.getTracks().forEach(track => track.stop())
    return null
  }
  await ensureCaptureModule(context)
  if (isCancelled()) {
    stream.getTracks().forEach(track => track.stop())
    return null
  }
  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, CAPTURE_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
  })
  // A silent path to the output keeps the node pulled by the audio thread in every browser.
  const sink = context.createGain()
  sink.gain.value = 0
  const capture: Capture = { stream, source, node, sink, frames: [] }
  node.port.onmessage = event => {
    if (event.data instanceof Float32Array) {
      capture.frames.push(event.data)
    }
  }
  source.connect(node)
  node.connect(sink)
  sink.connect(context.destination)
  return capture
}

function flush(capture: Capture): Promise<void> {
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, 500)
    const previous = capture.node.port.onmessage
    capture.node.port.onmessage = event => {
      if (event.data === 'flushed') {
        clearTimeout(timeout)
        resolve()
        return
      }
      previous?.call(capture.node.port, event)
    }
    capture.node.port.postMessage('flush')
  })
}

export function createMicRecorder(getContext: () => AudioContext): MicRecorder {
  let session: RecordingSession | null = null

  return {
    start: () => {
      const context = getContext()
      const current: RecordingSession = {
        cancelled: false,
        ready: openCapture(context, () => current.cancelled),
      }
      session = current
      return current.ready.then(() => undefined)
    },
    stop: async () => {
      const current = session
      session = null
      if (!current) {
        throw new Error('The microphone is not recording.')
      }
      const capture = await current.ready
      if (!capture) {
        return new Float32Array(0)
      }
      await flush(capture)
      release(capture)
      return await resampleTo16k(joinFrames(capture.frames), getContext().sampleRate)
    },
    cancel: () => {
      const current = session
      session = null
      if (!current) {
        return
      }
      current.cancelled = true
      void current.ready
        .then(capture => {
          if (capture) {
            release(capture)
          }
        })
        .catch(() => {})
    },
  }
}

function joinFrames(frames: readonly Float32Array[]): Float32Array {
  const joined = new Float32Array(frames.reduce((total, frame) => total + frame.length, 0))
  let offset = 0
  for (const frame of frames) {
    joined.set(frame, offset)
    offset += frame.length
  }
  return joined
}

async function resampleTo16k(samples: Float32Array, sampleRate: number): Promise<Float32Array> {
  if (samples.length === 0 || sampleRate === WHISPER_SAMPLE_RATE) {
    return samples
  }
  const length = Math.max(1, Math.round((samples.length * WHISPER_SAMPLE_RATE) / sampleRate))
  // Offline rendering runs as fast as it can, independent of any audio output clock.
  const offline = new OfflineAudioContext(1, length, WHISPER_SAMPLE_RATE)
  const buffer = offline.createBuffer(1, samples.length, sampleRate)
  buffer.getChannelData(0).set(samples)
  const source = offline.createBufferSource()
  source.buffer = buffer
  source.connect(offline.destination)
  source.start()
  return (await offline.startRendering()).getChannelData(0)
}

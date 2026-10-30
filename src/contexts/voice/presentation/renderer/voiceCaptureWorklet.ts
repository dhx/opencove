// Runs in the AudioWorkletGlobalScope, which lib.dom does not describe.
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor & {
    process(inputs: Float32Array[][]): boolean
  },
): void

/**
 * Copies each block of the microphone's first channel to the page. A `flush` message is answered
 * after every block before it, because port messages keep their order; the recorder waits for
 * that answer so the last words are not lost.
 */
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  public constructor() {
    super()
    this.port.onmessage = event => {
      if (event.data === 'flush') {
        this.port.postMessage('flushed')
      }
    }
  }

  public process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0]
    if (channel && channel.length > 0) {
      this.port.postMessage(channel.slice(0))
    }
    return true
  }
}

registerProcessor('opencove-voice-capture', VoiceCaptureProcessor)

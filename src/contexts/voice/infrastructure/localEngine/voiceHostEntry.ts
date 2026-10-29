import { setPriority } from 'node:os'
import process from 'node:process'
import { createVoiceHostHandler } from './voiceHostHandler'
import { loadVoiceModels } from './voiceHostModels'

// Entry of the voice host, forked by the worker's LocalVoiceEngine with `serialization: 'advanced'`
// so Float32Array audio crosses the IPC channel as is.

const send = process.send?.bind(process)
if (!send) {
  throw new Error('[voice-host] must be forked with an IPC channel')
}

// Inference shares the CPU with the agents; it should yield to them, not the other way round.
try {
  setPriority(10)
} catch {
  // Not permitted in some containers. Running at normal priority is still correct.
}

const handle = createVoiceHostHandler({
  loadModels: loadVoiceModels,
  send: reply => {
    send(reply)
  },
})

process.on('message', message => {
  void handle(message)
})

// The worker went away; nothing is left to answer to.
process.on('disconnect', () => {
  process.exit(0)
})

import { describe, expect, it } from 'vitest'
import { VoiceRequestGate } from '../../../src/contexts/voice/application/VoiceRequestGate'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

describe('VoiceRequestGate', () => {
  it('runs one client’s requests one after another, never calling that client busy', async () => {
    const gate = new VoiceRequestGate()
    const order: string[] = []
    const first = deferred()

    const a = gate.run('tab-1', async () => {
      order.push('a start')
      await first.promise
      order.push('a end')
    })
    const b = gate.run('tab-1', async () => {
      order.push('b')
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(order).toEqual(['a start'])

    first.resolve()
    await expect(a).resolves.toEqual({ ran: true, value: undefined })
    await expect(b).resolves.toEqual({ ran: true, value: undefined })
    expect(order).toEqual(['a start', 'a end', 'b'])
  })

  it('turns another client away while one is in a request', async () => {
    const gate = new VoiceRequestGate()
    const hold = deferred()
    const a = gate.run('tab-1', () => hold.promise)

    await expect(gate.run('tab-2', async () => 'never')).resolves.toEqual({ ran: false })

    hold.resolve()
    await a
    await expect(gate.run('tab-2', async () => 'now')).resolves.toEqual({ ran: true, value: 'now' })
  })

  it('frees the gate when a request fails', async () => {
    const gate = new VoiceRequestGate()

    await expect(
      gate.run('tab-1', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    await expect(gate.run('tab-2', async () => 1)).resolves.toEqual({ ran: true, value: 1 })
  })
})

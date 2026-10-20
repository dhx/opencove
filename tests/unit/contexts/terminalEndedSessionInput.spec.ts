import { describe, expect, it } from 'vitest'
import {
  isEndedTerminalStatus,
  syncEndedSessionInput,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/endedSessionInput'

describe('input to an ended terminal session', () => {
  it('is off while the session has ended and on again once it runs', () => {
    const terminal = { options: { disableStdin: false } }
    syncEndedSessionInput(terminal as never, 'failed')
    expect(terminal.options.disableStdin).toBe(true)
    syncEndedSessionInput(terminal as never, 'exited')
    expect(terminal.options.disableStdin).toBe(true)
    syncEndedSessionInput(terminal as never, 'running')
    expect(terminal.options.disableStdin).toBe(false)
  })

  it('treats exited, failed and stopped as ended, and nothing else', () => {
    expect(['exited', 'failed', 'stopped'].every(s => isEndedTerminalStatus(s as never))).toBe(true)
    expect(
      ['running', 'standby', 'waiting', 'restoring', null].some(s =>
        isEndedTerminalStatus(s as never),
      ),
    ).toBe(false)
  })

  it('does nothing without a terminal', () => {
    expect(() => syncEndedSessionInput(null, 'failed')).not.toThrow()
  })
})

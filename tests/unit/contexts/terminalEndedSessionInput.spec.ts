import { describe, expect, it, vi } from 'vitest'
import { stopEndedSessionInput } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/endedSessionInput'
import { subscribeRuntimeTerminalEvents } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession.events'

function subscribe(terminal: { options: { disableStdin: boolean } }) {
  const exitListeners: Array<(event: { sessionId: string; exitCode: number }) => void> = []
  const handleExit = vi.fn()
  const hub = {
    onSessionData: () => () => undefined,
    onSessionExit: (_sessionId: string, listener: (typeof exitListeners)[number]) => {
      exitListeners.push(listener)
      return () => undefined
    },
    onSessionGeometry: () => () => undefined,
    onSessionResync: () => () => undefined,
  }
  subscribeRuntimeTerminalEvents({
    ptyEventHub: hub,
    sessionId: 'session-1',
    openCodeThemeBridge: null,
    runtimeInputBridge: { handlePtyOutputChunk: () => undefined },
    diagnosticsEnabled: false,
    terminalDiagnostics: { log: () => undefined },
    restoredAgentVisibilityGate: { notifyOutputObserved: () => undefined },
    hydrationRouter: { handleDataChunk: () => undefined, handleExit },
    lastCommittedPtySizeRef: { current: null },
    terminal,
    syncTerminalSize: () => undefined,
    scheduleTranscriptSync: () => undefined,
    requestTerminalRendererRecovery: () => undefined,
  } as never)
  return {
    exit: (exitCode: number) => exitListeners.forEach(l => l({ sessionId: 'session-1', exitCode })),
    handleExit,
  }
}

describe('input to a terminal whose session exited', () => {
  it('stays on while the session runs and is turned off when its PTY exits', () => {
    const terminal = { options: { disableStdin: false } }
    const { exit, handleExit } = subscribe(terminal)
    expect(terminal.options.disableStdin).toBe(false)
    exit(1)
    expect(handleExit).toHaveBeenCalledWith(1)
    expect(terminal.options.disableStdin).toBe(true)
  })

  it('leaves a terminal whose input is already off as it is', () => {
    const terminal = { options: { disableStdin: true } }
    stopEndedSessionInput(terminal as never)
    expect(terminal.options.disableStdin).toBe(true)
  })
})

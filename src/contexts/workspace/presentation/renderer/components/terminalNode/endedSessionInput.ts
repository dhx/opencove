import { useEffect } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { AgentRuntimeStatus } from '../../types'

/** A terminal whose process is gone: what it showed stays, nothing reaches it any more. */
export function isEndedTerminalStatus(status: AgentRuntimeStatus | null): boolean {
  return status === 'exited' || status === 'failed' || status === 'stopped'
}

/**
 * Keys, paste, and the mouse and focus reports a TUI left switched on all go through xterm's
 * stdin. For an ended session they would be sent to a process that no longer exists (and the
 * attempt used to re-attach and replay the session's whole output), so stdin is off while the
 * session has ended and on again once it runs.
 */
export function syncEndedSessionInput(
  terminal: Pick<Terminal, 'options'> | null,
  status: AgentRuntimeStatus | null,
): void {
  if (!terminal) {
    return
  }
  const disableStdin = isEndedTerminalStatus(status)
  if (terminal.options.disableStdin !== disableStdin) {
    terminal.options.disableStdin = disableStdin
  }
}

/** Keeps a terminal node's stdin in step with its status, also after hydration: a reused xterm
 * session is handed back with stdin on. */
export function useEndedSessionInput({
  terminalRef,
  status,
  sessionId,
  isTerminalHydrated,
}: {
  terminalRef: { current: Pick<Terminal, 'options'> | null }
  status: AgentRuntimeStatus | null
  sessionId: string
  isTerminalHydrated: boolean
}): void {
  useEffect(() => {
    syncEndedSessionInput(terminalRef.current, status)
  }, [terminalRef, status, sessionId, isTerminalHydrated])
}

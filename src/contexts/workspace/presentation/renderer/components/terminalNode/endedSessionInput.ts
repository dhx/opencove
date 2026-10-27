import type { Terminal } from '@xterm/xterm'

/**
 * Called when the terminal's PTY session exits. Keys, paste, and the mouse and focus reports a
 * TUI left switched on all go through xterm's stdin; after exit they would be sent to a process
 * that no longer exists (and the attempt used to re-attach and replay the session's whole
 * output). What the terminal shows stays. A new session gets a terminal with stdin on again
 * (runtimeSessionFactory).
 *
 * Keyed on the PTY's exit, not on the node's status: a terminal whose Agent ended still runs
 * its shell.
 */
export function stopEndedSessionInput(terminal: Pick<Terminal, 'options'>): void {
  if (!terminal.options.disableStdin) {
    terminal.options.disableStdin = true
  }
}

import type {
  ResizeTerminalInput,
  TerminalAgentReexecInput,
  TerminalAgentReexecResult,
  TerminalGeometryCommitResult,
} from '@shared/contracts/dto'

/**
 * The sessions a browser PTY client has seen exit. Input, a resize or a re-exec for one of them
 * must not attach to it again: an implicit attach after exit has no seq to resume from, so the
 * hub would replay all of the session's retained output and its exit once more. They are
 * answered here, as the hub answers for a session that is no longer running. Only an explicit
 * attach (or a detach) lifts the mark.
 */
export class BrowserPtyExitedSessions {
  private readonly sessionIds = new Set<string>()

  public mark(sessionId: string): void {
    this.sessionIds.add(sessionId)
  }

  public clear(sessionId: string): void {
    this.sessionIds.delete(sessionId)
  }

  public has(sessionId: string): boolean {
    return this.sessionIds.has(sessionId)
  }

  public resizeResult(payload: ResizeTerminalInput): TerminalGeometryCommitResult {
    return {
      sessionId: payload.sessionId,
      operationId: payload.operationId ?? `browser-exited-${payload.sessionId}`,
      status: 'session_not_found',
      changed: false,
      geometry: null,
      authority: null,
    }
  }

  public reexecResult(payload: TerminalAgentReexecInput): TerminalAgentReexecResult {
    return {
      sessionId: payload.sessionId,
      operationId: payload.operationId ?? `browser-exited-${payload.sessionId}`,
      status: 'session_not_found',
    }
  }
}

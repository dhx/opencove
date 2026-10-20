import { describe, expect, it } from 'vitest'
import { updateWorkspacesWithAgentExit } from '../../../src/app/renderer/shell/hooks/usePtyWorkspaceRuntimeSync'
import { createTerminalAgentWorkspace } from './terminalAgentExit.testSupport'

function runningAgentWorkspace() {
  const workspace = createTerminalAgentWorkspace('claude-code')
  workspace.nodes[0].data.kind = 'agent'
  workspace.nodes[0].data.status = 'running'
  return workspace
}

describe('a repeated Agent exit', () => {
  it.each([0, 1])('ends the node once and changes nothing the second time (code=%s)', exitCode => {
    const first = updateWorkspacesWithAgentExit({
      workspaces: [runningAgentWorkspace()],
      sessionId: 'pty-1',
      exitCode,
      now: '2026-10-20T17:00:00Z',
    })
    expect(first.didChange).toBe(true)
    expect(first.nextWorkspaces[0].nodes[0].data).toMatchObject({
      status: exitCode === 0 ? 'exited' : 'failed',
      endedAt: '2026-10-20T17:00:00Z',
      exitCode,
    })

    // The same exit again, as a replay after a re-attach would deliver it.
    const again = updateWorkspacesWithAgentExit({
      workspaces: first.nextWorkspaces,
      sessionId: 'pty-1',
      exitCode,
      now: '2026-10-20T17:05:00Z',
    })
    expect(again.didChange).toBe(false)
    expect(again.nextWorkspaces[0]).toBe(first.nextWorkspaces[0])
    expect(again.nextWorkspaces[0].nodes[0].data.endedAt).toBe('2026-10-20T17:00:00Z')
  })

  it('still records a different exit code', () => {
    const first = updateWorkspacesWithAgentExit({
      workspaces: [runningAgentWorkspace()],
      sessionId: 'pty-1',
      exitCode: 0,
      now: '2026-10-20T17:00:00Z',
    })
    const other = updateWorkspacesWithAgentExit({
      workspaces: first.nextWorkspaces,
      sessionId: 'pty-1',
      exitCode: 1,
      now: '2026-10-20T17:05:00Z',
    })
    expect(other.didChange).toBe(true)
    expect(other.nextWorkspaces[0].nodes[0].data).toMatchObject({ status: 'failed', exitCode: 1 })
  })
})

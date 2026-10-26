import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findWorkspaceRootRefusal } from '../../../src/contexts/workspace/infrastructure/approval/workspaceRootGuard'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerWorkspaceHandlers } from '../../../src/app/main/controlSurface/handlers/workspaceHandlers'
import { registerFilesystemHandlers } from '../../../src/app/main/controlSurface/handlers/filesystemHandlers'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'

const posixOptions = {
  homeDirectory: '/home/alice',
  userDataPath: '/home/alice/.config/opencove',
  platform: 'linux' as const,
  resolveRealPath: async () => null,
}

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('workspace root guard', () => {
  it.each([
    ['/', /filesystem root/],
    ['/home/alice', /home directory/],
    ['/home/alice/', /home directory/],
    ['/home', /home directory/],
    ['/home/alice/.ssh', /~\/\.ssh/],
    ['/home/alice/.gnupg/private-keys-v1.d', /~\/\.gnupg/],
    ['/home/alice/.config', /data directory|~\/\.config/],
    ['/home/alice/.config/gh', /~\/\.config/],
    ['/home/alice/.claude', /~\/\.claude/],
    ['/home/alice/.codex/sessions', /~\/\.codex/],
    ['/home/alice/.config/opencove', /data directory/],
    ['/home/alice/.config/opencove/logs', /data directory/],
  ])('refuses %s', async (path, reason) => {
    await expect(findWorkspaceRootRefusal(path, posixOptions)).resolves.toMatch(reason)
  })

  it.each([
    '/home/alice/work/project',
    '/home/alice/.configs-are-not-config',
    '/srv/repos/app',
    '/home/alice/.config/opencove/projects/project-1',
  ])('allows %s', async path => {
    await expect(findWorkspaceRootRefusal(path, posixOptions)).resolves.toBeNull()
  })

  it('refuses Windows drive roots and the profile directory case-insensitively', async () => {
    const options = {
      homeDirectory: 'C:\\Users\\Alice',
      userDataPath: 'C:\\Users\\Alice\\AppData\\Roaming\\opencove',
      platform: 'win32' as const,
      resolveRealPath: async () => null,
    }
    await expect(findWorkspaceRootRefusal('C:\\', options)).resolves.toMatch(/filesystem root/)
    await expect(findWorkspaceRootRefusal('c:\\users\\alice', options)).resolves.toMatch(/home/)
    await expect(findWorkspaceRootRefusal('C:\\Users\\Alice\\.SSH', options)).resolves.toMatch(
      /\.ssh/,
    )
    await expect(findWorkspaceRootRefusal('D:\\code\\app', options)).resolves.toBeNull()
  })

  it('follows symlinks into a secret folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-root-guard-'))
    roots.push(root)
    const home = join(root, 'home')
    await mkdir(join(home, '.ssh'), { recursive: true })
    const link = join(root, 'innocent-looking')
    await symlink(join(home, '.ssh'), link)

    await expect(
      findWorkspaceRootRefusal(link, { homeDirectory: home, userDataPath: join(root, 'data') }),
    ).resolves.toMatch(/\.ssh/)
  })

  it('makes workspace.approveRoot fail with a clear error and not register the root', async () => {
    const registered: string[] = []
    const controlSurface = createControlSurface()
    registerWorkspaceHandlers(controlSurface, {
      approvedWorkspaces: {
        registerRoot: async path => {
          registered.push(path)
        },
        isPathApproved: async () => false,
      },
      userDataPath: '/var/lib/opencove',
    })
    const ctx = { now: () => new Date(), capabilities: {} } as unknown as ControlSurfaceContext

    const refused = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'workspace.approveRoot',
      payload: { path: '/' },
    })
    expect(refused).toMatchObject({
      ok: false,
      error: {
        code: 'common.invalid_input',
        debugMessage: expect.stringContaining('filesystem root'),
      },
    })

    const project = await mkdtemp(join(tmpdir(), 'opencove-root-guard-project-'))
    roots.push(project)
    const accepted = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'workspace.approveRoot',
      payload: { path: project },
    })
    expect(accepted.ok).toBe(true)
    expect(registered).toEqual([project])
  })

  it('lets the remote directory picker list a home-like folder without approving it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'opencove-browse-home-'))
    roots.push(home)
    await mkdir(join(home, 'repo'))
    await writeFile(join(home, 'notes.txt'), 'private')
    const registered: string[] = []
    const controlSurface = createControlSurface()
    registerFilesystemHandlers(controlSurface, {
      approvedWorkspaces: {
        registerRoot: async path => {
          registered.push(path)
        },
        isPathApproved: async () => false,
      },
    })
    const ctx = { now: () => new Date(), capabilities: {} } as unknown as ControlSurfaceContext

    const browsed = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'filesystem.browseDirectory',
      payload: { uri: pathToFileURL(home).href },
    })
    expect(browsed).toMatchObject({ ok: true, value: { entries: [{ name: 'repo' }] } })
    expect(browsed.ok && (browsed.value as { entries: unknown[] }).entries).toHaveLength(1)
    expect(registered).toEqual([])

    const read = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'filesystem.readDirectory',
      payload: { uri: pathToFileURL(home).href },
    })
    expect(read.ok).toBe(false)
  })
})

import { realpath } from 'node:fs/promises'
import { posix, win32, type PlatformPath } from 'node:path'

/** Folders under the home directory that hold credentials or Agent configuration. */
export const SENSITIVE_HOME_DIRECTORY_NAMES = [
  '.ssh',
  '.gnupg',
  '.config',
  '.claude',
  '.codex',
] as const

export interface WorkspaceRootGuardOptions {
  homeDirectory: string
  userDataPath: string
  platform?: NodeJS.Platform
  /** Resolves symlinks; defaults to `fs.realpath`. Returns `null` when the path does not exist. */
  resolveRealPath?: (path: string) => Promise<string | null>
}

/**
 * Returns why `rootPath` must not become an approved workspace root, or `null` when it may.
 *
 * An approved root lets Agents and terminals be started inside it and lets the filesystem API read
 * and write below it, so the filesystem root, the home directory (and anything above it), secret
 * folders and the worker's own data directory are refused. Project placeholders that the worker
 * creates itself (`<userData>/projects/<id>`) stay allowed.
 */
export async function findWorkspaceRootRefusal(
  rootPath: string,
  options: WorkspaceRootGuardOptions,
): Promise<string | null> {
  const platform = options.platform ?? process.platform
  const path = platform === 'win32' ? win32 : posix
  const resolveRealPath = options.resolveRealPath ?? defaultResolveRealPath

  const candidates = await withRealPaths([path.resolve(rootPath)], resolveRealPath)
  const homes = await withRealPaths(
    options.homeDirectory.trim() ? [path.resolve(options.homeDirectory)] : [],
    resolveRealPath,
  )
  const userDataRoots = await withRealPaths(
    options.userDataPath.trim() ? [path.resolve(options.userDataPath)] : [],
    resolveRealPath,
  )

  for (const candidate of candidates) {
    if (path.parse(candidate).root === candidate) {
      return 'the filesystem root cannot be approved as a workspace'
    }

    if (homes.some(home => isSameOrInside(path, platform, home, candidate))) {
      return 'the home directory (or a folder containing it) cannot be approved as a workspace'
    }

    const isProjectPlaceholder = userDataRoots.some(userData =>
      isStrictlyInside(path, platform, path.join(userData, 'projects'), candidate),
    )
    if (isProjectPlaceholder) {
      continue
    }

    if (userDataRoots.some(userData => isSameOrInside(path, platform, candidate, userData))) {
      return "OpenCove's own data directory cannot be approved as a workspace"
    }

    for (const home of homes) {
      for (const name of SENSITIVE_HOME_DIRECTORY_NAMES) {
        if (isSameOrInside(path, platform, candidate, path.join(home, name))) {
          return `folders inside ~/${name} cannot be approved as a workspace`
        }
      }
    }
  }

  return null
}

async function withRealPaths(
  paths: string[],
  resolveRealPath: (path: string) => Promise<string | null>,
): Promise<string[]> {
  const result = new Set(paths)
  for (const value of paths) {
    // eslint-disable-next-line no-await-in-loop -- at most one path per list
    const real = await resolveRealPath(value).catch(() => null)
    if (real) {
      result.add(real)
    }
  }
  return [...result]
}

async function defaultResolveRealPath(value: string): Promise<string | null> {
  try {
    return await realpath(value)
  } catch {
    return null
  }
}

function comparable(platform: NodeJS.Platform, value: string): string {
  return platform === 'win32' || platform === 'darwin' ? value.toLowerCase() : value
}

/** True when `inner` equals `outer` or lies below it. */
function isSameOrInside(
  path: PlatformPath,
  platform: NodeJS.Platform,
  inner: string,
  outer: string,
): boolean {
  const relative = path.relative(comparable(platform, outer), comparable(platform, inner))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function isStrictlyInside(
  path: PlatformPath,
  platform: NodeJS.Platform,
  outer: string,
  inner: string,
): boolean {
  const relative = path.relative(comparable(platform, outer), comparable(platform, inner))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

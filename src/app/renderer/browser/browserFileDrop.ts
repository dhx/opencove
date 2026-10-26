import type { FileSystemStat, ResolveDroppedFileOptions } from '@shared/contracts/dto'
import { getBrowserQueryToken, invokeBrowserControlSurface } from './browserControlSurface'

interface FileDropAnswer {
  path: string
  uri: string
}

async function postFileDrop(
  file: File,
  extraHeaders: Record<string, string>,
): Promise<FileDropAnswer> {
  const headers: Record<string, string> = {
    'x-opencove-drop': '1',
    'x-file-name': encodeURIComponent(file.name || 'pasted'),
    ...extraHeaders,
  }
  const token = getBrowserQueryToken()
  if (token) {
    headers.authorization = `Bearer ${token}`
  }

  const response = await fetch('/files/drop', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: file,
  })
  const result = (await response.json().catch(() => null)) as {
    ok?: boolean
    path?: string
    uri?: string
    error?: string
  } | null
  if (!response.ok || !result?.ok || typeof result.path !== 'string') {
    throw new Error(result?.error ?? `The worker answered ${response.status}.`)
  }
  return { path: result.path, uri: typeof result.uri === 'string' ? result.uri : '' }
}

/**
 * Sends a file dropped or pasted onto a terminal to the worker, which keeps it and answers its path
 * (`/files/drop`): a browser does not tell the page where a file lives, so the Web UI cannot paste the
 * file's own path as the desktop app does.
 */
export async function uploadDroppedFileToWorker(file: File): Promise<string> {
  return (await postFileDrop(file, {})).path
}

/**
 * A file dropped onto the canvas in the Web UI: uploaded into `<targetDirectoryPath>/dropped/` (a
 * project folder the worker has approved) and answered as that new file. Without a target
 * directory there is nowhere to keep it, so nothing is uploaded.
 */
export async function resolveDroppedFileInBrowser(
  file: File,
  options?: ResolveDroppedFileOptions,
): Promise<FileSystemStat | null> {
  const directory = options?.targetDirectoryPath?.trim() ?? ''
  if (!directory) {
    return null
  }
  const { uri } = await postFileDrop(file, { 'x-drop-directory': encodeURIComponent(directory) })
  return await invokeBrowserControlSurface<FileSystemStat>({
    kind: 'query',
    id: 'filesystem.stat',
    payload: { uri },
  })
}

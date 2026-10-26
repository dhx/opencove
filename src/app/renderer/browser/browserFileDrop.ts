import { getBrowserQueryToken } from './browserControlSurface'

/**
 * Sends a file dropped or pasted onto a terminal to the worker, which keeps it and answers its path
 * (`/files/drop`): a browser does not tell the page where a file lives, so the Web UI cannot paste the
 * file's own path as the desktop app does.
 */
export async function uploadDroppedFileToWorker(file: File): Promise<string> {
  const headers: Record<string, string> = {
    'x-opencove-drop': '1',
    'x-file-name': encodeURIComponent(file.name || 'pasted'),
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
    error?: string
  } | null
  if (!response.ok || !result?.ok || typeof result.path !== 'string') {
    throw new Error(result?.error ?? `The worker answered ${response.status}.`)
  }
  return result.path
}

import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export async function writeConnectionFile(
  userDataPath: string,
  info: unknown,
  fileName: string,
): Promise<void> {
  const filePath = resolve(userDataPath, fileName)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(info)}\n`, { encoding: 'utf8', mode: 0o600 })
  if (process.platform !== 'win32') {
    // `mode` only applies when the file is created; tighten a file left by an older version.
    await chmod(filePath, 0o600)
  }
}

export async function removeConnectionFile(userDataPath: string, fileName: string): Promise<void> {
  const filePath = resolve(userDataPath, fileName)
  await rm(filePath, { force: true })
}

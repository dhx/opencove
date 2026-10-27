import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rootDir = resolve(import.meta.dirname, '../../..')

describe('CI image', () => {
  // Browsers in the Playwright image are only found by the Playwright version they were built for.
  it('builds on the Playwright image of the locked version, pinned by digest', async () => {
    const dockerfile = await readFile(resolve(rootDir, 'ci/image/Dockerfile'), 'utf8')
    const lock = await readFile(resolve(rootDir, 'pnpm-lock.yaml'), 'utf8')

    const from = dockerfile.match(
      /^FROM mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble@sha256:[0-9a-f]{64}$/m,
    )
    const locked = lock.match(/^ {2}'@playwright\/test@(\d+\.\d+\.\d+)':$/m)

    expect(from, 'FROM pinned by tag and digest').not.toBeNull()
    expect(locked, '@playwright/test in pnpm-lock.yaml').not.toBeNull()
    expect(from?.[1]).toBe(locked?.[1])
  })
})

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rootDir = resolve(import.meta.dirname, '../../..')

describe('CI E2E browser provisioning', () => {
  // This fork runs CI on Linux only (docs/dhx/RELEASES.md).
  it('installs Chromium before Desktop/Web continuity tests on Linux', async () => {
    // This fork runs the Electron suite in its own workflow (e2e-electron.yml).
    const workflow = await readFile(resolve(rootDir, '.github/workflows/e2e-electron.yml'), 'utf8')
    const jobs = [workflow.slice(workflow.indexOf('  e2e-ubuntu:'))]

    for (const job of jobs) {
      const installAt = job.indexOf('Install Chromium for Desktop/Web continuity E2E')
      const testAt = job.indexOf('E2E tests (shard)')
      expect(installAt).toBeGreaterThanOrEqual(0)
      expect(job).toContain("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: ''")
      expect(job).toContain('pnpm exec playwright install')
      expect(installAt).toBeLessThan(testAt)
    }
  })
})

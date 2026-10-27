import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rootDir = resolve(import.meta.dirname, '../../..')

// This fork runs CI on Linux only (docs/dhx/RELEASES.md). Every job that drives a browser runs in
// Microsoft's Playwright image, which carries the browsers and their system libraries, instead of
// installing them with apt on each run.
const BROWSER_JOBS = [
  { workflow: '.github/workflows/e2e-electron.yml', job: 'e2e-ubuntu' },
  { workflow: '.github/workflows/ci.yml', job: 'web-canvas-continuity-ubuntu' },
  { workflow: '.github/workflows/ci.yml', job: 'e2e-web' },
]

const IMAGE = /image: mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble@sha256:[0-9a-f]{64}\n/

async function readJob(workflowPath: string, jobName: string): Promise<string> {
  const workflow = await readFile(resolve(rootDir, workflowPath), 'utf8')
  const start = workflow.indexOf(`\n  ${jobName}:\n`)
  if (start < 0) {
    throw new Error(`Missing CI job ${jobName} in ${workflowPath}`)
  }
  const next = workflow.slice(start + 1).search(/\n {2}[\w-]+:\n/)
  return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next)
}

async function lockedPlaywrightVersion(): Promise<string> {
  const lock = await readFile(resolve(rootDir, 'pnpm-lock.yaml'), 'utf8')
  const match = lock.match(/^ {2}'@playwright\/test@(\d+\.\d+\.\d+)':$/m)
  if (!match) {
    throw new Error('Missing @playwright/test in pnpm-lock.yaml')
  }
  return match[1]
}

describe('CI E2E browser provisioning', () => {
  for (const { workflow, job } of BROWSER_JOBS) {
    it(`${job} runs in the Playwright image of the locked version, pinned by digest`, async () => {
      const text = await readJob(workflow, job)
      const image = text.match(IMAGE)

      expect(image, 'container image pinned by tag and digest').not.toBeNull()
      // Browsers in the image are only found by the same Playwright version.
      expect(image?.[1]).toBe(await lockedPlaywrightVersion())
      expect(text).not.toContain('playwright install')
    })
  }
})

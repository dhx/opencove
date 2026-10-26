import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { webTargetSkips } from '../../e2e/webTarget/skips'

const e2eDir = resolve(import.meta.dirname, '../../e2e')

// The web target's skip list (tests/e2e/webTarget/skips.ts) must not outlive the tests it skips:
// an entry whose spec file or test title is gone would silently stop meaning anything.
describe('E2E web target skip list', () => {
  it('names spec files that exist', () => {
    const missing = webTargetSkips
      .map(skip => skip.file)
      .filter(file => !file.endsWith('.spec.ts') || !existsSync(resolve(e2eDir, file)))
    expect(missing).toEqual([])
  })

  it('names test titles that exist in their spec file', () => {
    const missing = webTargetSkips
      .filter(skip => typeof skip.title === 'string' && existsSync(resolve(e2eDir, skip.file)))
      .filter(skip => !readFileSync(resolve(e2eDir, skip.file), 'utf8').includes(skip.title ?? ''))
      .map(skip => `${skip.file} › ${skip.title}`)
    expect(missing).toEqual([])
  })

  it('has no duplicate entries and gives every entry a reason', () => {
    const keys = webTargetSkips.map(skip => `${skip.file}\u0000${skip.title ?? ''}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(webTargetSkips.filter(skip => skip.reason.trim().length === 0)).toEqual([])
  })
})

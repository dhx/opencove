// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  githubRepository,
  inspectGithubPluginRepository,
  PLUGIN_CATALOG_OFF_MESSAGE,
} from '../../../../src/contexts/plugins/infrastructure/GithubPluginRepository'
import { GitPluginSources } from '../../../../src/contexts/plugins/infrastructure/GitPluginSources'
const commit = 'a'.repeat(40)
const credentialFixture = new URL('https://github.com/a/b')
credentialFixture.username = 'fixture'
credentialFixture.password = 'synthetic-test-value'
const manifest = {
  apiVersion: 1,
  id: 'example',
  version: '1.0.0',
  displayName: 'Example',
  description: 'A plugin',
  main: 'main.mjs',
  view: { entry: 'index.html' },
}
const file = (text: string, path = 'README.md') => ({
  type: 'file',
  size: Buffer.byteLength(text),
  encoding: 'base64',
  content: Buffer.from(text).toString('base64'),
  path,
})
beforeEach(() => vi.stubEnv('OPENCOVE_PLUGIN_CATALOG', '1'))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
describe('plugin catalog switch', () => {
  it.each([undefined, '', '0', 'true'])(
    'does not contact GitHub unless OPENCOVE_PLUGIN_CATALOG=1 (%s)',
    async value => {
      vi.stubEnv('OPENCOVE_PLUGIN_CATALOG', value)
      const fetcher = vi.fn()
      vi.stubGlobal('fetch', fetcher)
      await expect(inspectGithubPluginRepository('https://github.com/a/b')).rejects.toThrow(
        PLUGIN_CATALOG_OFF_MESSAGE,
      )
      await expect(new GitPluginSources('/nonexistent').discover('theme')).rejects.toThrow(
        PLUGIN_CATALOG_OFF_MESSAGE,
      )
      expect(fetcher).not.toHaveBeenCalled()
    },
  )
  it('searches GitHub for the plugin topic when the catalog is on', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                full_name: 'a/b',
                html_url: 'https://github.com/a/b',
                description: 'd',
                stargazers_count: 1,
              },
            ],
          }),
        ),
    )
    vi.stubGlobal('fetch', fetcher)
    const result = await new GitPluginSources('/nonexistent').discover('theme')
    expect(result.repositories.map(repository => repository.url)).toEqual([
      'https://github.com/a/b',
    ])
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('topic%3Aopencove-plugin')
  })
})
describe('read-only GitHub plugin details', () => {
  it('pins README and manifest to a resolved commit without installing or running code', async () => {
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes('/commits/')
              ? { sha: commit }
              : url.includes('/readme?')
                ? file('# Welcome\n![Screenshot](images/window.png)')
                : url.includes('/contents/')
                  ? file(JSON.stringify(manifest))
                  : {
                      default_branch: 'feature/docs',
                      description: 'Repository',
                      stargazers_count: 8,
                    },
          ),
        ),
    )
    vi.stubGlobal('fetch', fetcher)
    expect(
      await inspectGithubPluginRepository('https://github.com/example/plugin.git'),
    ).toMatchObject({
      name: 'example/plugin',
      commit,
      ref: 'feature/docs',
      manifest,
      readme: expect.stringContaining('# Welcome'),
    })
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'https://api.github.com/repos/example/plugin',
      'https://api.github.com/repos/example/plugin/commits/feature%2Fdocs',
      `https://api.github.com/repos/example/plugin/readme?ref=${commit}`,
      `https://api.github.com/repos/example/plugin/contents/opencove.plugin.json?ref=${commit}`,
    ])
  })
  it.each([
    'https://evil.test/owner/repo',
    'http://github.com/a/b',
    credentialFixture.href,
    'https://github.com/a/b?token=secret',
    'https://github.com/a/b/tree/main',
  ])('rejects unsupported repository %s before network access', url => {
    expect(() => githubRepository(url)).toThrow()
  })
  it('returns readable docs with a missing or invalid root manifest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/contents/')) {
          return new Response('', { status: 404 })
        }
        return new Response(
          JSON.stringify(
            url.includes('/commits/')
              ? { sha: commit }
              : url.includes('/readme?')
                ? file('# Build this package')
                : { default_branch: 'main' },
          ),
        )
      }),
    )
    expect(await inspectGithubPluginRepository('https://github.com/a/b')).toMatchObject({
      manifest: null,
      manifestError: expect.stringContaining('No root'),
      readme: '# Build this package',
    })
  })
  it('bounds streamed response bytes without trusting Content-Length', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x'.repeat(1024 * 1024 + 1))),
    )
    await expect(inspectGithubPluginRepository('https://github.com/a/b')).rejects.toThrow(
      'size limit',
    )
  })
  it('reports rate limits and does not follow redirects to other hosts', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 403 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(inspectGithubPluginRepository('https://github.com/a/b')).rejects.toThrow('403')
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: 'error' }),
    )
  })
})

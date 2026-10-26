// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  formatWorkerReadyLine,
  resolveWorkerSecrets,
  scrubWorkerSecretEnv,
} from '../../../src/app/worker/workerSecrets'
import {
  isLoopbackBindHostname,
  resolveWorkerBindRefusal,
} from '../../../src/app/worker/workerBindPolicy'

function readFrom(files: Record<string, string>) {
  return (path: string): string => {
    const content = files[path]
    if (content === undefined) {
      throw new Error('ENOENT')
    }
    return content
  }
}

describe('worker secrets', () => {
  it('reads the token and Web UI password from the environment', () => {
    expect(
      resolveWorkerSecrets([], {
        OPENCOVE_WORKER_TOKEN: ' env-token ',
        OPENCOVE_WEB_UI_PASSWORD: 'env-password',
      }),
    ).toEqual({ token: 'env-token', webUiPassword: 'env-password', webUiPasswordHash: null })

    expect(resolveWorkerSecrets([], { OPENCOVE_WEB_UI_PASSWORD_HASH: 'scrypt:a:b' })).toEqual({
      token: null,
      webUiPassword: null,
      webUiPasswordHash: 'scrypt:a:b',
    })
  })

  it('reads secrets from files and strips the trailing newline', () => {
    const readFile = readFrom({ '/run/token': 'file-token\n', '/run/password': 'pw\n' })
    expect(
      resolveWorkerSecrets(
        ['--token-file', '/run/token', '--web-ui-password-file=/run/password'],
        {},
        readFile,
      ),
    ).toEqual({ token: 'file-token', webUiPassword: 'pw', webUiPasswordHash: null })
  })

  it('keeps the old flags working and lets them win over the environment', () => {
    expect(
      resolveWorkerSecrets(['--token=flag-token', '--web-ui-password-hash', 'scrypt:x:y'], {
        OPENCOVE_WORKER_TOKEN: 'env-token',
        OPENCOVE_WEB_UI_PASSWORD: 'env-password',
      }),
    ).toEqual({ token: 'flag-token', webUiPassword: null, webUiPasswordHash: 'scrypt:x:y' })
  })

  it('refuses ambiguous or unusable secret sources', () => {
    expect(() =>
      resolveWorkerSecrets(['--token=a', '--token-file=/run/token'], {}, readFrom({})),
    ).toThrow('choose either --token or --token-file')
    expect(() => resolveWorkerSecrets(['--token-file=/missing'], {}, readFrom({}))).toThrow(
      'cannot read --token-file',
    )
    expect(() =>
      resolveWorkerSecrets(['--token-file=/empty'], {}, readFrom({ '/empty': '\n' })),
    ).toThrow('is empty')
    expect(() =>
      resolveWorkerSecrets([], {
        OPENCOVE_WEB_UI_PASSWORD: 'pw',
        OPENCOVE_WEB_UI_PASSWORD_HASH: 'scrypt:a:b',
      }),
    ).toThrow('choose either')
  })

  it('removes the secret variables from the environment children inherit', () => {
    const env: NodeJS.ProcessEnv = {
      OPENCOVE_WORKER_TOKEN: 't',
      OPENCOVE_WEB_UI_PASSWORD: 'p',
      OPENCOVE_WEB_UI_PASSWORD_HASH: 'h',
      PATH: '/usr/bin',
    }
    scrubWorkerSecretEnv(env)
    expect(env).toEqual({ PATH: '/usr/bin' })
  })

  it('prints the token only to a Desktop parent', () => {
    const info = { version: 1, hostname: '127.0.0.1', port: 8081, token: 'secret-token' }
    const redacted = formatWorkerReadyLine(info, {
      includeToken: false,
      connectionFilePath: '/data/worker-control-surface.json',
    })
    expect(redacted).not.toContain('secret-token')
    expect(JSON.parse(redacted)).toEqual({
      version: 1,
      hostname: '127.0.0.1',
      port: 8081,
      tokenRedacted: true,
      connectionFile: '/data/worker-control-surface.json',
    })

    const desktop = formatWorkerReadyLine(info, {
      includeToken: true,
      connectionFilePath: '/data/worker-control-surface.json',
    })
    expect(JSON.parse(desktop)).toEqual(info)
  })
})

describe('worker bind policy', () => {
  it('recognises loopback hostnames', () => {
    for (const hostname of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]']) {
      expect(isLoopbackBindHostname(hostname)).toBe(true)
    }
    for (const hostname of ['0.0.0.0', '::', '192.168.1.10', 'opencove.example']) {
      expect(isLoopbackBindHostname(hostname)).toBe(false)
    }
  })

  it('refuses a non-loopback bind without a password or an explicit override', () => {
    expect(
      resolveWorkerBindRefusal({
        bindHostname: '0.0.0.0',
        webUiPasswordConfigured: false,
        allowInsecureBind: false,
      }),
    ).toContain('refusing to listen on 0.0.0.0')
    expect(
      resolveWorkerBindRefusal({
        bindHostname: '0.0.0.0',
        webUiPasswordConfigured: true,
        allowInsecureBind: false,
      }),
    ).toBeNull()
    expect(
      resolveWorkerBindRefusal({
        bindHostname: '::',
        webUiPasswordConfigured: false,
        allowInsecureBind: true,
      }),
    ).toBeNull()
    expect(
      resolveWorkerBindRefusal({
        bindHostname: '127.0.0.1',
        webUiPasswordConfigured: false,
        allowInsecureBind: false,
      }),
    ).toBeNull()
  })
})

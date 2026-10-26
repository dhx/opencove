import { describe, expect, it } from 'vitest'
import {
  isWebsiteUrlOnAppOrigin,
  resolveWebsiteNavigationUrl,
  resolveWebsitePasteUrl,
} from './websiteUrl'

describe('websiteUrl', () => {
  it('accepts common navigation inputs', () => {
    expect(resolveWebsiteNavigationUrl('https://example.com/docs').url).toBe(
      'https://example.com/docs',
    )
    expect(resolveWebsiteNavigationUrl('example.com/docs').url).toBe('https://example.com/docs')
  })

  it('only auto-creates website nodes from strict pasted URLs', () => {
    expect(resolveWebsitePasteUrl('hello world').url).toBeNull()
    expect(resolveWebsitePasteUrl('just-text').url).toBeNull()
    expect(resolveWebsitePasteUrl('example.com').url).toBe('https://example.com/')
    expect(resolveWebsitePasteUrl('localhost:3000/test').url).toBe('https://localhost:3000/test')
    expect(resolveWebsitePasteUrl('https://openai.com/research').url).toBe(
      'https://openai.com/research',
    )
  })

  it('refuses website URLs on the app host or the app port on loopback', () => {
    const app = 'https://cove.example.test/'
    for (const url of [
      'https://cove.example.test/',
      'http://cove.example.test:8080/plugin-assets/x/index.html',
      'https://COVE.example.test/debug',
      'https://localhost/',
      'https://127.0.0.1:443/',
    ]) {
      expect(isWebsiteUrlOnAppOrigin(url, app)).toBe(true)
    }
    for (const url of [
      'https://example.com/',
      'http://localhost:3000/',
      'https://sub.cove.example.test/',
    ]) {
      expect(isWebsiteUrlOnAppOrigin(url, app)).toBe(false)
    }

    const local = 'http://127.0.0.1:3200/'
    for (const url of [
      'http://127.0.0.1:3200/x',
      'http://localhost:3200/',
      'http://[::1]:3200/',
      'http://127.0.0.2:3200/',
      'http://127.0.0.1:5173/',
    ]) {
      expect(isWebsiteUrlOnAppOrigin(url, local)).toBe(true)
    }
    expect(isWebsiteUrlOnAppOrigin('http://localhost:5173/', local)).toBe(false)
    // The desktop app is not served over http(s); its website windows are separate native views.
    expect(isWebsiteUrlOnAppOrigin('http://localhost:3200/', 'file:///app/index.html')).toBe(false)
  })
})

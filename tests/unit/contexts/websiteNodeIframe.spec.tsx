import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  WEBSITE_NODE_IFRAME_SANDBOX,
  WebsiteNodeIframe,
  resolveWebsiteIframeSourceUrl,
} from '../../../src/contexts/workspace/presentation/renderer/components/WebsiteNode.iframe'

describe('WebsiteNodeIframe', () => {
  it('keeps iframe sandbox permissive enough for browser fallback navigation', () => {
    render(<WebsiteNodeIframe url="about:blank" displayTitle="Example" />)

    const iframe = screen.getByTitle('Example')
    expect(iframe).toHaveAttribute('src', 'about:blank')
    expect(iframe).toHaveAttribute('sandbox', WEBSITE_NODE_IFRAME_SANDBOX)
    expect(WEBSITE_NODE_IFRAME_SANDBOX).toContain('allow-same-origin')
    expect(WEBSITE_NODE_IFRAME_SANDBOX).toContain('allow-top-navigation-by-user-activation')
  })

  it('does not embed the app itself', () => {
    const appUrl = new URL(window.location.href)
    if (!/^https?:$/.test(appUrl.protocol)) {
      window.history.replaceState(null, '', 'http://localhost:3000/')
    }
    const own = new URL('/plugin-assets/token/index.html', window.location.href).href
    render(<WebsiteNodeIframe url={own} displayTitle="Own" />)

    expect(screen.queryByTitle('Own')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('OpenCove does not show itself')
  })

  it('uses iframe-friendly Google entrypoints for search and home pages', () => {
    expect(resolveWebsiteIframeSourceUrl('https://google.com/')).toBe(
      'https://www.google.com/webhp?igu=1',
    )
    expect(resolveWebsiteIframeSourceUrl('https://www.google.com/search?q=opencove')).toBe(
      'https://www.google.com/search?q=opencove&igu=1',
    )
    expect(resolveWebsiteIframeSourceUrl('https://mail.google.com/mail/u/0/')).toBe(
      'https://mail.google.com/mail/u/0/',
    )
  })
})

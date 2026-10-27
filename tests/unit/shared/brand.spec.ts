import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { translate } from '../../../src/app/renderer/i18n'
import {
  FAVICON_DATA_URI,
  NOT_OFFICIAL_NOTE,
  PRODUCT_NAME,
  brandText,
} from '../../../src/shared/brand/brand'

const rootDir = resolve(import.meta.dirname, '../../..')

// OpenCove's TRADEMARKS.md asks a modified build to use its own name and say it is not official.
describe('brand', () => {
  it('names this fork wherever interface text names OpenCove, but leaves the CLI name', () => {
    expect(brandText('Choose how OpenCove looks.')).toBe('Choose how Session Desk looks.')
    expect(brandText('Read opencove plugin guide')).toBe('Read opencove plugin guide')
  })

  it('applies to translated interface text', () => {
    expect(translate('settingsPanel.general.uiThemeHelp')).toBe(`Choose how ${PRODUCT_NAME} looks.`)
  })

  it('says that this is not an official OpenCove build', () => {
    expect(NOT_OFFICIAL_NOTE).toContain('not an official OpenCove build')
  })

  it('gives the Web UI page its name and icon', async () => {
    const html = await readFile(resolve(rootDir, 'src/app/renderer/web.html'), 'utf8')
    expect(html).toContain(`<title>${PRODUCT_NAME}</title>`)
    expect(html).toContain(`href="${FAVICON_DATA_URI}"`)
  })
})

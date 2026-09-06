/**
 * The overscroll/rubber-band area is painted by the html element, not by any
 * page wrapper, so html must carry the app background in both themes. A white
 * canvas here is what shows when the user pulls past the end of the page.
 */
import { test, expect } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

const LIGHT_BASE = 'rgb(248, 246, 244)' // --cs-base
const DARK_BASE = 'rgb(17, 16, 9)' // .dark --cs-base

async function rootStyle(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const s = getComputedStyle(document.documentElement)
    return {
      background: s.backgroundColor,
      colorScheme: s.colorScheme,
      dark: document.documentElement.classList.contains('dark'),
    }
  })
}

test.describe('Page canvas background', () => {
  test('light theme paints html with the app background', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('theme', 'light'))
    await page.goto(`${BASE_URL}/login`)
    await page.waitForLoadState('networkidle')

    const s = await rootStyle(page)
    expect(s.dark).toBe(false)
    expect(s.background).toBe(LIGHT_BASE)
    expect(s.colorScheme).toBe('light')
  })

  test('dark theme paints html with the dark background', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
    await page.goto(`${BASE_URL}/login`)
    await page.waitForLoadState('networkidle')

    const s = await rootStyle(page)
    expect(s.dark).toBe(true)
    expect(s.background).toBe(DARK_BASE)
    expect(s.colorScheme).toBe('dark')
  })

  test('dark theme is applied before React mounts, so there is no light flash', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
    // domcontentloaded fires before the React bundle has run its effects; the
    // inline script in index.html must already have set the class by then.
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' })

    const s = await rootStyle(page)
    expect(s.dark).toBe(true)
    expect(s.background).toBe(DARK_BASE)
  })
})

/**
 * Capture README screenshots. Run via: ./screenshots/run.sh
 * Skipped unless SCREENSHOT_EMAIL is set (requires backend running with E2E_TEST=1).
 */
import { test, expect, type Page } from '@playwright/test'

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:5173'
const EMAIL = process.env.SCREENSHOT_EMAIL ?? ''
const OUT = '../screenshots'

const MOBILE = { width: 375, height: 812 }
const DESKTOP = { width: 1280, height: 800 }

async function authedPage(page: Page, viewport: { width: number; height: number }, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme })
  await page.setViewportSize(viewport)
  // Log in via test-login — sets the session cookie on the browser context.
  await page.request.post(`${BASE}/api/auth/test-login`, { data: { email: EMAIL, name: 'Screenshot User' } })
  await page.goto(BASE)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
}

test.describe('Screenshots', () => {
  test.beforeEach(() => {
    test.skip(!EMAIL, 'Set SCREENSHOT_EMAIL env var to run screenshot tests')
  })

  test('dashboard - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.screenshot({ path: `${OUT}/dashboard-light-mobile.png` })
  })

  test('dashboard - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.screenshot({ path: `${OUT}/dashboard-dark-mobile.png` })
  })

  test('dashboard - light - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'light')
    await page.screenshot({ path: `${OUT}/dashboard-light-desktop.png` })
  })

  test('dashboard - dark - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'dark')
    await page.screenshot({ path: `${OUT}/dashboard-dark-desktop.png` })
  })

  test('admin - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.click('text=Admin')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${OUT}/admin-light-mobile.png` })
  })

  test('admin - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.click('text=Admin')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${OUT}/admin-dark-mobile.png` })
  })

  test('events page - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.click('text=Events')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/events-light-mobile.png` })
  })

  test('events page - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.click('text=Events')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/events-dark-mobile.png` })
  })

  test('import-export page - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.click('text=Import')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/import-export-mobile.png` })
  })

  test('sales page - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.click('text=Sales')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/sales-light-mobile.png`, fullPage: true })
  })

  test('sales page - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.click('text=Sales')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/sales-dark-mobile.png`, fullPage: true })
  })

  test('settings page - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.click('text=Settings')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/settings-light-mobile.png` })
  })

  test('settings page - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.click('text=Settings')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/settings-dark-mobile.png` })
  })

  test('login page - light - mobile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize(MOBILE)
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')
    // wait for privacy blurb to appear (doesn't need external Google script)
    await page.waitForTimeout(800)
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/login-light-mobile.png`, fullPage: true })
  })

  test('login page - dark - mobile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize(MOBILE)
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/login-dark-mobile.png`, fullPage: true })
  })

  test('privacy policy page - light - mobile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize(MOBILE)
    await page.goto(`${BASE}/privacy`)
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: `${OUT}/privacy-light-mobile.png` })
  })

  test('grants - epic mode - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    // Enable Epic Mode via admin API (demo user is admin)
    await page.request.post(`${BASE}/api/admin/epic-mode`, { data: { active: true } })
    await page.goto(`${BASE}`)
    await page.waitForLoadState('networkidle')
    await page.click('text=Grants')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/grants-epic-mode-light-mobile.png`, fullPage: true })
    await page.request.post(`${BASE}/api/admin/epic-mode`, { data: { active: false } })
  })

  test('grants - epic mode - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.request.post(`${BASE}/api/admin/epic-mode`, { data: { active: true } })
    await page.goto(`${BASE}`)
    await page.waitForLoadState('networkidle')
    await page.click('text=Grants')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/grants-epic-mode-dark-mobile.png`, fullPage: true })
    await page.request.post(`${BASE}/api/admin/epic-mode`, { data: { active: false } })
  })

  test('wizard - welcome - light - mobile', async ({ page }) => {
    // /wizard always shows the wizard (isPage=true) regardless of existing data
    await authedPage(page, MOBILE, 'light')
    await page.goto(`${BASE}/wizard`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/wizard-welcome-light-mobile.png`, fullPage: true })
  })

  test('wizard - welcome - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.goto(`${BASE}/wizard`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/wizard-welcome-dark-mobile.png`, fullPage: true })
  })

  test('wizard - grant entry - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.goto(`${BASE}/wizard`)
    await page.waitForLoadState('networkidle')
    // Welcome screen → Manual entry → prices → "Next: Add grants" → grant entry.
    await page.click('text=Manual entry')
    await page.waitForTimeout(300)
    await page.click('text=Next: Add grants')
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${OUT}/wizard-grant-entry-light-mobile.png`, fullPage: true })
  })

  test('wizard page - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.goto(`${BASE}/wizard`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/wizard-page-light-mobile.png`, fullPage: true })
  })

  test('settings sharing section - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.click('text=Settings')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    const sharingHeading = page.locator('h2, h3').filter({ hasText: 'Sharing' }).first()
    await sharingHeading.scrollIntoViewIfNeeded()
    await expect(sharingHeading).toBeInViewport()
    await page.screenshot({ path: `${OUT}/settings-sharing-light-mobile.png` })
  })

  test('settings sharing section - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.click('text=Settings')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    const sharingHeading = page.locator('h2, h3').filter({ hasText: 'Sharing' }).first()
    await sharingHeading.scrollIntoViewIfNeeded()
    await expect(sharingHeading).toBeInViewport()
    await page.screenshot({ path: `${OUT}/settings-sharing-dark-mobile.png` })
  })

  test('invite landing page - light - mobile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize(MOBILE)
    await page.goto(`${BASE}/invite?code=XXXX-YYYY`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${OUT}/invite-landing-light-mobile.png`, fullPage: true })
  })

  test('content - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.getByRole('link', { name: 'Content', exact: true }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/content-light-mobile.png`, fullPage: true })
  })

  test('content - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.getByRole('link', { name: 'Content', exact: true }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/content-dark-mobile.png`, fullPage: true })
  })

  test('content - light - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'light')
    await page.getByRole('link', { name: 'Content', exact: true }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/content-light-desktop.png`, fullPage: true })
  })

  test('content - dark - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'dark')
    await page.getByRole('link', { name: 'Content', exact: true }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/content-dark-desktop.png`, fullPage: true })
  })

  test('comp calculator - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.goto(`${BASE}/comp-calculator`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/comp-calculator-light-mobile.png`, fullPage: true })
  })

  test('comp calculator - light - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'light')
    await page.goto(`${BASE}/comp-calculator`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/comp-calculator-light-desktop.png`, fullPage: true })
  })

  test('comp calculator - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.goto(`${BASE}/comp-calculator`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/comp-calculator-dark-mobile.png`, fullPage: true })
  })

  test('comp calculator - rolling avg - light - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'light')
    await page.goto(`${BASE}/comp-calculator`)
    await page.waitForLoadState('networkidle')
    await page.click('text=3-year average')
    await page.click('text=5-year average')
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${OUT}/comp-calculator-rolling-light-desktop.png`, fullPage: true })
  })

  test('loans - epic mode - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.request.post(`${BASE}/api/admin/epic-mode`, { data: { active: true } })
    await page.goto(`${BASE}`)
    await page.waitForLoadState('networkidle')
    await page.click('text=Loans')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/loans-epic-mode-light-mobile.png`, fullPage: true })
    await page.request.post(`${BASE}/api/admin/epic-mode`, { data: { active: false } })
  })
})

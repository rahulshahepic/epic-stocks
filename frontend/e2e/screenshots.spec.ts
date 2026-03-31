/**
 * Capture README screenshots. Run via: ./screenshots/run.sh
 * Skipped unless SCREENSHOT_EMAIL is set (requires backend running with E2E_TEST=1).
 */
import { test, type Page } from '@playwright/test'

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
    await page.screenshot({ path: `${OUT}/dashboard-light-mobile.png`, fullPage: true })
  })

  test('dashboard - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.screenshot({ path: `${OUT}/dashboard-dark-mobile.png`, fullPage: true })
  })

  test('dashboard - light - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'light')
    await page.screenshot({ path: `${OUT}/dashboard-light-desktop.png`, fullPage: true })
  })

  test('dashboard - dark - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'dark')
    await page.screenshot({ path: `${OUT}/dashboard-dark-desktop.png`, fullPage: true })
  })

  test('admin - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.click('text=Admin')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${OUT}/admin-light-mobile.png`, fullPage: true })
  })

  test('admin - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.click('text=Admin')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${OUT}/admin-dark-mobile.png`, fullPage: true })
  })

  test('events page - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.click('text=Events')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/events-light-mobile.png`, fullPage: true })
  })

  test('events page - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.click('text=Events')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/events-dark-mobile.png`, fullPage: true })
  })

  test('import-export page - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.click('text=Import')
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: `${OUT}/import-export-mobile.png`, fullPage: true })
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
    await page.screenshot({ path: `${OUT}/settings-light-mobile.png`, fullPage: true })
  })

  test('settings page - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.click('text=Settings')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/settings-dark-mobile.png`, fullPage: true })
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
    await page.screenshot({ path: `${OUT}/privacy-light-mobile.png`, fullPage: true })
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

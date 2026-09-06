/**
 * Capture README screenshots. Run via: ./screenshots/run.sh
 * Skipped unless SCREENSHOT_EMAIL is set (requires backend running with E2E_TEST=1).
 */
import { test, expect, type Page } from '@playwright/test'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:5173'
const EMAIL = process.env.SCREENSHOT_EMAIL ?? ''
const OUT = '../screenshots'

const TRIAL_CSV = path.resolve(__dirname, '../../test_data/epic_share_summary.csv')
const TRIAL_PDF = path.resolve(__dirname, '../../test_data/epic_loan_statement.pdf')

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

/**
 * Capture, with the page scrolled back to the top when the shot is fullPage.
 *
 * The top chrome is `sticky top-0`, and a fullPage capture does not reset the
 * scroll — it stitches from wherever the page happens to be. So whatever
 * Playwright scrolled to in order to fill a field or click a button is where
 * the sticky header renders in the image. On the retirement shots that put
 * the whole nav bar halfway down the page, slicing through the Social
 * Security section, with a blank strip left at the top where it belongs.
 *
 * A viewport-sized shot keeps its scroll: there, what is on screen is the
 * point of the screenshot.
 */
async function shoot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  if (opts.fullPage) {
    // Waits for a painted frame rather than guessing at a delay — the sticky
    // header only moves back on the next layout.
    await page.evaluate(() => new Promise<void>(resolve => {
      window.scrollTo(0, 0)
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
  }
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts })
}

test.describe('Screenshots', () => {
  // These seed data, wait for networkidle and capture whole pages, so they run
  // far longer than an assertion test. A dozen of them sat at 29.3-30.1s
  // against the config's 30s, which is not a passing test so much as one that
  // has not failed yet — the next 300ms spent anywhere would have done it.
  test.describe.configure({ timeout: 120_000 })

  test.beforeEach(() => {
    test.skip(!EMAIL, 'Set SCREENSHOT_EMAIL env var to run screenshot tests')
  })

  test('dashboard - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await shoot(page, 'dashboard-light-mobile')
  })

  test('dashboard - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await shoot(page, 'dashboard-dark-mobile')
  })

  test('dashboard - light - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'light')
    await shoot(page, 'dashboard-light-desktop')
  })

  test('dashboard - dark - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'dark')
    await shoot(page, 'dashboard-dark-desktop')
  })

  test('admin - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.click('text=Admin')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    await shoot(page, 'admin-light-mobile')
  })

  test('admin - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.click('text=Admin')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    await shoot(page, 'admin-dark-mobile')
  })

  test('events page - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.click('text=Events')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'events-light-mobile')
  })

  test('events page - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.click('text=Events')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'events-dark-mobile')
  })

  test('import-export page - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.click('text=Import')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    // fullPage: the export card and its as-of date sit below the fold.
    await shoot(page, 'import-export-mobile', { fullPage: true })
  })

  test('new user empty state - light - mobile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize(MOBILE)
    await page.request.post(`${BASE}/api/auth/test-login`,
      { data: { email: 'brand-new@e2e.test', name: 'New User' } })
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
    await shoot(page, 'new-user-light-mobile', { fullPage: true })
  })

  test('import diagnostics page - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.goto(`${BASE}/import-diagnostics`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'import-diagnostics-light-mobile', { fullPage: true })
  })

  test('sales page - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.click('text=Sales')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'sales-light-mobile', { fullPage: true })
  })

  test('sales page - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.click('text=Sales')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'sales-dark-mobile', { fullPage: true })
  })

  test('settings page - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.click('text=Settings')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'settings-light-mobile')
  })

  test('settings page - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.click('text=Settings')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'settings-dark-mobile')
  })

  test('login page - light - mobile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize(MOBILE)
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')
    // wait for privacy blurb to appear (doesn't need external Google script)
    await page.waitForTimeout(800)
    await page.waitForTimeout(500)
    await shoot(page, 'login-light-mobile', { fullPage: true })
  })

  test('login page - dark - mobile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize(MOBILE)
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    await page.waitForTimeout(500)
    await shoot(page, 'login-dark-mobile', { fullPage: true })
  })

  // The report dialog, from the pre-login side — the case that matters most,
  // because it is the one a person reaches when they cannot get in at all.
  test('report dialog - light - mobile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize(MOBILE)
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Report a problem' }).click()
    await page.getByPlaceholder('What were you doing when it broke?')
      .fill('Signing in with Google sends me back to this page every time.')
    await page.waitForTimeout(500)
    await shoot(page, 'report-light-mobile')
  })

  test('report dialog - dark - mobile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize(MOBILE)
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Report a problem' }).click()
    await page.getByPlaceholder('What were you doing when it broke?')
      .fill('Signing in with Google sends me back to this page every time.')
    await page.waitForTimeout(500)
    await shoot(page, 'report-dark-mobile')
  })

  test('try page - light - mobile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize(MOBILE)
    await page.goto(`${BASE}/try`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    await shoot(page, 'try-light-mobile', { fullPage: true })
  })

  test('try page - dark - mobile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize(MOBILE)
    await page.goto(`${BASE}/try`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    await shoot(page, 'try-dark-mobile', { fullPage: true })
  })

  /** Upload the synthetic Shareworks fixtures and land on the computed preview. */
  async function previewPage(page: Page, viewport: { width: number; height: number }, scheme: 'light' | 'dark') {
    await page.emulateMedia({ colorScheme: scheme })
    await page.setViewportSize(viewport)
    await page.goto(`${BASE}/try`)
    await page.waitForLoadState('networkidle')
    await page.locator('#trial-csv').setInputFiles(TRIAL_CSV)
    await page.locator('#trial-pdf').setInputFiles(TRIAL_PDF)
    await page.getByRole('button', { name: 'See my numbers' }).click()
    await page.getByText('Net worth', { exact: false }).first().waitFor({ timeout: 20000 })
    await page.waitForTimeout(1500)
  }

  test('try preview dashboard - light - mobile', async ({ page }) => {
    await previewPage(page, MOBILE, 'light')
    await shoot(page, 'try-preview-light-mobile', { fullPage: true })
  })

  test('try preview dashboard - dark - mobile', async ({ page }) => {
    await previewPage(page, MOBILE, 'dark')
    await shoot(page, 'try-preview-dark-mobile', { fullPage: true })
  })

  test('try preview dashboard - light - desktop', async ({ page }) => {
    await previewPage(page, DESKTOP, 'light')
    await shoot(page, 'try-preview-light-desktop', { fullPage: true })
  })

  test('try preview events - light - mobile', async ({ page }) => {
    await previewPage(page, MOBILE, 'light')
    await page.getByRole('button', { name: 'Events' }).click()
    await page.waitForTimeout(600)
    await shoot(page, 'try-preview-events-light-mobile', { fullPage: true })
  })

  test('privacy policy page - light - mobile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize(MOBILE)
    await page.goto(`${BASE}/privacy`)
    await page.waitForLoadState('networkidle')
    await shoot(page, 'privacy-light-mobile')
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
    await shoot(page, 'grants-epic-mode-light-mobile', { fullPage: true })
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
    await shoot(page, 'grants-epic-mode-dark-mobile', { fullPage: true })
    await page.request.post(`${BASE}/api/admin/epic-mode`, { data: { active: false } })
  })

  test('wizard - welcome - light - mobile', async ({ page }) => {
    // /wizard always shows the wizard (isPage=true) regardless of existing data
    await authedPage(page, MOBILE, 'light')
    await page.goto(`${BASE}/wizard`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'wizard-welcome-light-mobile', { fullPage: true })
  })

  test('wizard - welcome - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.goto(`${BASE}/wizard`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'wizard-welcome-dark-mobile', { fullPage: true })
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
    await shoot(page, 'wizard-grant-entry-light-mobile', { fullPage: true })
  })

  test('wizard page - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.goto(`${BASE}/wizard`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'wizard-page-light-mobile', { fullPage: true })
  })

  test('settings sharing section - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.click('text=Settings')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    const sharingHeading = page.locator('h2, h3').filter({ hasText: 'Sharing' }).first()
    await sharingHeading.scrollIntoViewIfNeeded()
    await expect(sharingHeading).toBeInViewport()
    await shoot(page, 'settings-sharing-light-mobile')
  })

  test('settings sharing section - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.click('text=Settings')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    const sharingHeading = page.locator('h2, h3').filter({ hasText: 'Sharing' }).first()
    await sharingHeading.scrollIntoViewIfNeeded()
    await expect(sharingHeading).toBeInViewport()
    await shoot(page, 'settings-sharing-dark-mobile')
  })

  test('invite landing page - light - mobile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize(MOBILE)
    await page.goto(`${BASE}/invite?code=XXXX-YYYY`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    await shoot(page, 'invite-landing-light-mobile', { fullPage: true })
  })

  test('content - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.getByRole('link', { name: 'Content', exact: true }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'content-light-mobile', { fullPage: true })
  })

  test('content - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.getByRole('link', { name: 'Content', exact: true }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'content-dark-mobile', { fullPage: true })
  })

  test('content - light - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'light')
    await page.getByRole('link', { name: 'Content', exact: true }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'content-light-desktop', { fullPage: true })
  })

  test('content - dark - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'dark')
    await page.getByRole('link', { name: 'Content', exact: true }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'content-dark-desktop', { fullPage: true })
  })

  test('comp calculator - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.goto(`${BASE}/comp-calculator`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'comp-calculator-light-mobile', { fullPage: true })
  })

  test('comp calculator - light - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'light')
    await page.goto(`${BASE}/comp-calculator`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'comp-calculator-light-desktop', { fullPage: true })
  })

  test('comp calculator - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.goto(`${BASE}/comp-calculator`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'comp-calculator-dark-mobile', { fullPage: true })
  })

  test('comp calculator - rolling avg - light - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'light')
    await page.goto(`${BASE}/comp-calculator`)
    await page.waitForLoadState('networkidle')
    await page.click('text=3-year average')
    await page.click('text=5-year average')
    await page.waitForTimeout(300)
    await shoot(page, 'comp-calculator-rolling-light-desktop', { fullPage: true })
  })

  // Seed plausible portfolio values + DOB so the screenshots reflect a real
  // retirement plan rather than a $237K exit ruining at year 1.
  async function seedRetirement(page: Page) {
    // The Monte Carlo run below can take well over the 30s per-test default,
    // which capped the 60s waitForSelector and failed these three outright.
    test.setTimeout(150_000)
    await page.goto(`${BASE}/retirement`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    // DOB is the first <input type="date"> on the page.
    const dob = page.locator('input[type="date"]').first()
    await dob.click()
    await dob.fill('1976-04-15')
    await page.locator('body').click()
    await page.waitForTimeout(300)
    const fill = async (label: RegExp, value: string) => {
      const input = page.getByLabel(label, { exact: false })
      await input.click()
      await input.fill(value)
    }
    await fill(/Epic exit value/, '5')
    await fill(/Additional portfolio/, '1')
    await page.getByRole('button', { name: /Simulate.*retirements/ }).click()
    await page.waitForSelector('text=Ended richer than you started', { timeout: 60000 })
    await page.waitForTimeout(500)
  }

  test('retirement - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await seedRetirement(page)
    await shoot(page, 'retirement-light-mobile', { fullPage: true })
  })

  test('retirement - light - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'light')
    await seedRetirement(page)
    await shoot(page, 'retirement-light-desktop', { fullPage: true })
  })

  test('retirement - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await seedRetirement(page)
    await shoot(page, 'retirement-dark-mobile', { fullPage: true })
  })

  test('loans - epic mode - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.request.post(`${BASE}/api/admin/epic-mode`, { data: { active: true } })
    await page.goto(`${BASE}`)
    await page.waitForLoadState('networkidle')
    await page.click('text=Loans')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'loans-epic-mode-light-mobile', { fullPage: true })
    await page.request.post(`${BASE}/api/admin/epic-mode`, { data: { active: false } })
  })
})

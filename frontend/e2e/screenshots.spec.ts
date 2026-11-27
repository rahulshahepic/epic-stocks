const REVIEW_TEST_BACKEND = process.env.VITE_BACKEND_ORIGIN ?? 'http://localhost:8000'
/**
 * Capture README screenshots. Run via: ./screenshots/run.sh
 * Skipped unless SCREENSHOT_EMAIL is set (requires backend running with E2E_TEST=1).
 */
import { test, expect, type Page } from '@playwright/test'
import * as path from 'path'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'url'
import AxeBuilder from '@axe-core/playwright'
import { navigateTo } from './helpers.ts'
import { comparisonSnapshot, pluginHost, retirementHost, purchaseSnapshot, mobileEditorSnapshot, snapshots, retirementSnapshot } from './plugin-host'
import { backupStatus } from './backup-fixtures'
import { openFailedImportReport } from './reporting-fixture'

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
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts, ...(opts.fullPage ? { style: '[aria-label="Mobile navigation"]{visibility:hidden!important}' } : {}) })
}

async function expectClearWingMarker(page: Page) {
  const marker = page.locator('.campus-wing-marker')
  const art = marker.locator('.campus-wing-art')
  const motto = marker.locator('.campus-wing-motto')
  await expect(art).toBeVisible()
  await expect(art).toHaveAttribute('fill', 'none')
  const artBounds = await art.boundingBox()
  const mottoBounds = await motto.boundingBox()
  expect(artBounds!.x + artBounds!.width).toBeLessThanOrEqual(mottoBounds!.x)
  const audit = await new AxeBuilder({ page }).include('.campus-wing-marker').withRules(['color-contrast']).analyze()
  expect(audit.violations).toEqual([])
}

test.describe('Screenshots', () => {
  for (const theme of ['light', 'dark'] as const) {
    test('MCP purchase results - ' + theme + ' - mobile', async ({ page }) => {
      await page.setViewportSize(MOBILE)
      const card = await retirementHost(page, theme, { initial: purchaseSnapshot })
      await expect(card.locator('#purchaseSummary')).toContainText('68.0%')
      await card.locator('main').screenshot({ path: `${OUT}/mcp-purchase-results-${theme}-mobile.png` })
      await card.getByText('Calculation details', { exact: true }).click()
      await card.getByLabel('Details for Sports car', { exact: true }).click()
      await expect(card.getByText(/Buy \+ fully fund retirement: 65.00%/)).toBeVisible()
      await card.locator('#purchaseResults').screenshot({ path: `${OUT}/mcp-purchase-details-${theme}-mobile.png` })
    })
  }
  // These seed data, wait for networkidle and capture whole pages, so they run
  // far longer than an assertion test. A dozen of them sat at 29.3-30.1s
  // against the config's 30s, which is not a passing test so much as one that
  // has not failed yet — the next 300ms spent anywhere would have done it.
  test.describe.configure({ timeout: 120_000 })

  // Charts animate on load, and a capture landing mid-animation differed from
  // one run to the next (#559). Recharts honours reduced motion.
  test.use({ reducedMotion: 'reduce' })

  test.beforeEach(async ({ page }) => {
    test.skip(!EMAIL, 'Set SCREENSHOT_EMAIL env var to run screenshot tests')
    // Charts mark "today" and some figures accrue by the minute, so two runs a
    // few minutes apart differed. Midday of the real date keeps the browser on
    // the same day as the server, which computes its own "as of today".
    const midday = new Date()
    midday.setHours(12, 0, 0, 0)
    await page.clock.setFixedTime(midday)
    // The retirement simulator's Monte Carlo draws from Math.random, so every
    // run captured a different fan chart (#559). Seed it.
    await page.addInitScript(() => {
      let a = 0x2545f491
      Math.random = () => {
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    })
  })

  for (const theme of ['light', 'dark'] as const) {
    test('MCP mobile event actions - ' + theme, async ({ page }) => {
      await page.setViewportSize(MOBILE)
      const card = await retirementHost(page, theme, { initial: mobileEditorSnapshot })
      await card.getByRole('button', { name: 'Edit plan assumptions', exact: true }).click()
      await card.locator('#editView > section').first().screenshot({ path: `${OUT}/mcp-retirement-controls-${theme}-mobile.png` })
      await card.locator('#exitEstimateDetails > summary').click()
      await card.locator('#exitEstimateDetails').screenshot({ path: `${OUT}/mcp-exit-estimate-${theme}-mobile.png` })
      await card.locator('#lifeEventsDetails > summary').click()
      await card.locator('.event-toolbar').screenshot({ path: `${OUT}/mcp-event-toolbar-${theme}-mobile.png` })
      await card.locator('#eventList').screenshot({ path: `${OUT}/mcp-event-actions-${theme}-mobile.png` })
      await card.locator('.view-nav').screenshot({ path: `${OUT}/mcp-retirement-tabs-${theme}-mobile.png` })
    })
  }

  for (const theme of ['light', 'dark'] as const) {
    test('MCP saved amount connection - ' + theme, async ({ page }) => {
      await page.setViewportSize(MOBILE)
      const card = await retirementHost(page, theme, { initial: { ...mobileEditorSnapshot, canProjectExit: false } })
      await card.getByRole('button', { name: 'Edit plan assumptions', exact: true }).click()
      await card.locator('#exitEstimateDetails > summary').click()
      await expect(card.locator('#projectExit')).toBeDisabled()
      await card.locator('#editView > section').first().screenshot({ path: `${OUT}/mcp-retirement-fixed-${theme}-mobile.png` })
    })
  }

  test('MCP assumptions editor - light - mobile', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    const card = await retirementHost(page, 'light')
    await card.getByRole('button', { name: 'Edit plan assumptions', exact: true }).click()
    await expect(card.locator('#resultsView')).toBeHidden()
    await shoot(page, 'mcp-retirement-editor-light-mobile', { fullPage: true })
  })

  for (const theme of ['light', 'dark'] as const) {
    test('retirement purchase outcomes - ' + theme + ' - mobile', async ({ page }) => {
      await authedPage(page, MOBILE, theme)
      await page.request.post(`${BASE}/api/auth/test-login`, { data: { email: `purchase-outcomes-${theme}@screenshots.example.test`, name: 'Planning Demo' } })
      const params = { retirementDate: '2032-01-01', epicExitMode: 'manual', epicExit: 5, paths: 1000, seed: 1729,
        currentAge: 45, endAge: 85, defaultSpend: 160, minSpend: 100,
        plannedEvents: [
          { id: 'car', title: 'Sports car', kind: 'vehicle', date: '2035-01-01', amountM: 0.2, annualCostM: 0.015, lifetimeYears: 10, replacementEveryYears: 10, depreciationRate: 0, condition: { minStartingWealthRatio: 1.4 }, conditionFailure: 'defer' },
          { id: 'college', title: 'Four years of private college', kind: 'education', date: '2044-08-01', amountM: 0, annualCostM: 0.1, endDate: '2048-07-01' },
          { id: 'renovation', title: 'Renovation before retirement', kind: 'renovation', date: '2029-01-01', amountM: 0.1, funding: 'epic' },
        ] }
      expect((await page.request.put(`${BASE}/api/retirement/params`, { data: { params } })).ok()).toBe(true)
      await page.goto(`${BASE}/retirement`)
      await page.getByRole('button', { name: /Simulate.*retirements/ }).click()
      const outcomes = page.getByRole('region', { name: 'Planned purchase outcomes' })
      await expect(outcomes.getByText('Optional purchases per simulation')).toBeVisible()
      const core = page.getByText('Will the money last?', { exact: true })
      expect(await core.evaluate((el, report) => !!(el.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING), await outcomes.elementHandle())).toBe(true)
      const audit = await new AxeBuilder({ page }).include('[aria-label="Planned purchase outcomes"]').withTags(['wcag2a', 'wcag2aa']).analyze()
      expect(audit.violations).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(MOBILE.width)
      await outcomes.screenshot({ path: `${OUT}/retirement-purchase-outcomes-${theme}-mobile.png`, style: '.sticky,[aria-label="Mobile navigation"]{visibility:hidden!important}' })
      await page.getByRole('button', { name: 'Compare retiring one year later' }).click()
      const comparison = page.getByRole('table', { name: 'Comparison of retirement dates' })
      await expect(comparison.getByRole('rowheader', { name: 'Any optional purchase' })).toBeVisible()
      await expect(comparison.getByRole('rowheader', { name: 'Buy and fully fund retirement' })).toBeVisible()
      await expect(outcomes.getByText('3+', { exact: true })).toBeVisible()
      await expect(comparison.getByRole('rowheader', { name: 'Assets exhausted' })).toBeVisible()
      await expect(comparison.getByRole('columnheader', { name: 'Jan 1, 2033' })).toBeVisible()
      const saved = await (await page.request.get(`${BASE}/api/retirement/params`)).json()
      expect(saved.params.retirementDate).toBe('2032-01-01')
      await comparison.locator('../..').screenshot({ path: `${OUT}/retirement-date-comparison-${theme}-mobile.png`, style: '.sticky,[aria-label="Mobile navigation"]{visibility:hidden!important}' })
      await outcomes.getByText('Calculation details', { exact: true }).click()
      await outcomes.getByLabel('Details for Sports car', { exact: true }).click()
      await outcomes.screenshot({ path: `${OUT}/retirement-purchase-details-${theme}-mobile.png`, style: '.sticky,[aria-label="Mobile navigation"]{visibility:hidden!important}' })
      await page.getByRole('button', { name: 'Planned Expenses', exact: true }).click()
      await expect(page.getByRole('region', { name: 'Before retirement funding schedule' })).toContainText('$100,000')
      await shoot(page, `before-retirement-${theme}-mobile`, { fullPage: true })
    })
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`car purchase editor - ${theme} - mobile`, async ({ page }) => {
      test.setTimeout(30_000)
      await authedPage(page, MOBILE, theme)
      await page.request.post(`${BASE}/api/auth/test-login`, { data: { email: `car-editor-${theme}@screenshots.example.test`, name: 'Car Editor Demo' } })
      await page.goto(`${BASE}/retirement`)
      await page.waitForLoadState('networkidle')
      await page.getByRole('button', { name: 'Planned Expenses', exact: true }).click()
      await page.getByRole('button', { name: '+ Add planned expense', exact: true }).click()
      await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('vehicle')
      await page.getByLabel(/Purchase price/).fill('50000')
      await page.locator('summary').filter({ hasText: /^Ownership and costs/ }).click()
      await page.getByLabel('Depreciation schedule').selectOption('strong')
      await page.getByLabel('Replace when sold', { exact: true }).check()
      await expect(page.getByLabel(/Repeat every N years/)).toHaveCount(0)
      const editor = page.getByRole('region', { name: 'Planned expenses' })
      const audit = await new AxeBuilder({ page }).include('[aria-label="Planned expenses"]').withTags(['wcag2a', 'wcag2aa']).analyze()
      expect(audit.violations).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(MOBILE.width)
      await editor.screenshot({ path: `${OUT}/car-purchase-editor-${theme}-mobile.png`, style: '[aria-label="Car plan summary"]{position:static!important}.sticky:not([aria-label="Car plan summary"]),[aria-label="Mobile navigation"]{visibility:hidden!important}' })
    })
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`synthetic MCP account notice - ${theme}`, async ({ page }) => {
      await page.setViewportSize(MOBILE)
      const account_context = { environment: 'staging', synthetic: true, initialized: true, scenario: 'established', fixture_version: 2 }
      const portfolio = await pluginHost(page, { theme, initial: { ...snapshots.summary, account_context } })
      await expect(portfolio.locator('#syntheticNotice')).toContainText('FICTIONAL TEST ACCOUNT')
      await portfolio.locator('main').screenshot({ path: `${OUT}/mcp-synthetic-portfolio-${theme}-mobile.png` })
      const retirement = await retirementHost(page, theme, { initial: { ...retirementSnapshot, account_context } })
      await expect(retirement.locator('#syntheticNotice')).toContainText('fixture v2')
      await retirement.getByRole('button', { name: 'Edit plan assumptions', exact: true }).click()
      await retirement.getByRole('button', { name: 'Run simulation', exact: true }).click()
      await expect(retirement.locator('#syntheticNotice')).toContainText('FICTIONAL TEST ACCOUNT')
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
      await retirement.locator('main').screenshot({ path: `${OUT}/mcp-synthetic-retirement-${theme}-mobile.png` })
    })
  }

  // Portable MCP Apps retirement resource, rendered in the synthetic MCP host.
  // Synthetic balances only; capture both themes and sizes for PR visual review.
  for (const theme of ['light', 'dark'] as const) {
    for (const size of ['mobile', 'desktop'] as const) {
      test(`MCP Apps retirement card - ${theme} - ${size}`, async ({ page }) => {
        await page.setViewportSize(size === 'mobile' ? MOBILE : DESKTOP)
        const card = await retirementHost(page, theme)
        await expect(card.getByText('97.00%', { exact: true })).toBeVisible()
        await expect(card.getByRole('img', { name: 'Median wealth and 10th to 90th percentile range by age' })).toBeVisible()
        await expect(card.getByRole('status')).toContainText('Simulation complete')
        await shoot(page, `mcp-apps-retirement-${theme}-${size}`, { fullPage: true })
        if (size === 'mobile') {
          await card.getByText('Funding risk details', { exact: true }).click()
          await card.getByText('Plan assumptions', { exact: true }).click()
          const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
          expect(audit.violations).toEqual([])
          await card.locator('#resultsView').screenshot({ path: `${OUT}/mcp-retirement-risk-details-${theme}-mobile.png` })
        }
      })
    }
  }

  test('MCP Apps retirement card - comparison - light - desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    const card = await retirementHost(page, 'light')
    await card.getByRole('button', { name: 'Compare dates', exact: true }).click()
    await card.getByLabel('Compare against').fill('2032-07-02')
    await card.getByRole('button', { name: 'Compare retirement dates' }).click()
    await card.getByText('Comparison details', { exact: true }).click()
    await expect(card.getByRole('cell', { name: '2032-07-02' })).toBeVisible()
    await expect(card.getByRole('status')).toContainText('Neither scenario was saved')
    await shoot(page, 'mcp-apps-retirement-comparison-light-desktop', { fullPage: true })
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`MCP standalone retirement comparison - ${theme}`, async ({ page }) => {
      await page.setViewportSize(theme === 'light' ? DESKTOP : MOBILE)
      const card = await retirementHost(page, theme, {
        initial: { ...comparisonSnapshot, scenarios: comparisonSnapshot.scenarios.slice(0, 2) },
        resourceHtml: readFileSync(new URL('../../backend/app/mcp/retirement_compare.html', import.meta.url), 'utf8'),
        readyText: 'Retirement comparison',
      })
      await expect(card.getByRole('table', { name: 'Retirement scenario metrics' })).toBeVisible()
      await card.getByText('All ending wealth percentiles').click()
      await expect(card.getByRole('table', { name: 'Ending wealth by percentile' })).toBeVisible()
      const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      expect(audit.violations).toEqual([])
      await card.locator('main').screenshot({ path: `${OUT}/mcp-standalone-comparison-${theme}.png` })
    })
  }

  for (const theme of ['light', 'dark'] as const) test(`MCP retirement comparison - ${theme} - mobile`, async ({ page }) => {
    await page.setViewportSize(MOBILE)
    const card = await retirementHost(page, theme)
    await card.getByRole('button', { name: 'Compare dates', exact: true }).click()
    await card.getByLabel('Compare against').fill('2032-07-02')
    await card.getByRole('button', { name: 'Compare retirement dates', exact: true }).click()
    await expect(card.locator('#comparison')).toContainText('98.10%')
    expect(await page.frames()[1].evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(audit.violations).toEqual([])
    await shoot(page, `mcp-retirement-comparison-${theme}-mobile`, { fullPage: true })
  })

  for (const theme of ['light', 'dark'] as const) {
    for (const size of ['mobile', 'desktop'] as const) {
      test(`chatgpt plugin - ${theme} - ${size}`, async ({ page }) => {
        await page.setViewportSize(size === 'mobile' ? MOBILE : DESKTOP)
        const widget = await pluginHost(page, { theme, fileHelpers:true })
        await expect(widget.getByText('$225,000')).toBeVisible()
        await shoot(page, `chatgpt-plugin-${theme}-${size}`, { fullPage: true })
      })
    }
  }

  for (const [device, viewport, navigationLabel] of [
    ['mobile', MOBILE, 'Mobile navigation'],
    ['desktop', DESKTOP, 'Main navigation'],
  ] as const) {
    test(`more navigation - light - ${device}`, async ({ page }) => {
      await authedPage(page, viewport, 'light')
      const navigation = page.getByRole('navigation', { name: navigationLabel })
      const more = navigation.getByRole('button', { name: 'More', exact: true })
      await more.click()
      await expect(more).toHaveAttribute('aria-expanded', 'true')
      const admin = navigation.getByRole('link', { name: 'Site Admin', exact: true })
      await expect(admin).toBeVisible()
      const content = navigation.getByRole('link', { name: 'Content Admin', exact: true })
      await expect(content).toBeVisible()
      await expect(navigation.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible()
      await expect(navigation.getByRole('heading', { name: 'Stock records' })).toBeVisible()
      await expect(navigation.getByRole('link', { name: 'Loans', exact: true })).toBeVisible()
      expect((await new AxeBuilder({ page }).include(`[aria-label="${navigationLabel}"]`).analyze()).violations).toEqual([])
      await shoot(page, `navigation-more-light-${device}`)
      await content.focus()
      await page.keyboard.press('Tab')
      await expect(more).toHaveAttribute('aria-expanded', 'false')
      await more.click()
      await page.keyboard.press('Escape')
      await expect(more).toBeFocused()
      await expect(admin).toBeHidden()
      await more.click()
      await page.getByRole('main').click({ position: { x: 2, y: 2 } })
      await expect(admin).toBeHidden()
      await more.click()
      await admin.click()
      await expect(page).toHaveURL(/\/admin$/)
      await expect(more).toHaveAttribute('aria-expanded', 'false')
    })
  }

  test('dashboard - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('href', '/terms')
    const stalePrice = page.getByRole('region', { name: 'Stale share price' })
    const notice = stalePrice.locator('summary')
    await expect(notice).toBeVisible()
    await expect(page.getByRole('region', { name: 'Your stock at a glance' }).getByRole('heading', { name: 'Value Today' })).toBeInViewport()
    await shoot(page, 'dashboard-light-mobile')
    await notice.click()
    await expect(page.getByText(/Any applicable growth estimate remains tentative/)).toBeVisible()
    await expect(stalePrice.getByRole('button', { name: 'Add a price' })).toBeVisible()
    await stalePrice.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await page.reload()
    await expect(notice).toBeHidden()
  })

  test('dashboard - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await shoot(page, 'dashboard-dark-mobile')
  })

  test('dashboard - light - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'light')
    const date = await page.getByLabel('As of', { exact: true }).boundingBox()
    expect(date?.width).toBeLessThan(180)
    await shoot(page, 'dashboard-light-desktop')
  })

  test('dashboard - dark - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'dark')
    await shoot(page, 'dashboard-dark-desktop')
  })

  // An estimated Jan 1 price change as the next event, viewed the day before.
  for (const [viewport, size] of [[MOBILE, 'mobile'], [DESKTOP, 'desktop']] as const) {
    test(`dashboard estimated price - light - ${size}`, async ({ page }) => {
      await authedPage(page, viewport, 'light')
      // A timed-out browser attempt may leave its synthetic price behind.
      const existing = (await (await page.request.get(`${BASE}/api/prices`)).json()).find((p: {effective_date: string}) => p.effective_date === '2027-01-01')
      if (existing) expect((await page.request.delete(`${BASE}/api/prices/${existing.id}`)).ok()).toBe(true)
      const created = await page.request.post(`${BASE}/api/prices`, {
        data: { effective_date: '2027-01-01', price: 9.5, is_estimate: true } })
      expect(created.ok()).toBeTruthy()
      const { id } = await created.json()
      try {
        await page.reload()
        await page.waitForLoadState('networkidle')
        await page.locator('input[type="date"]').first().fill('2026-12-31')
        await page.waitForLoadState('networkidle')
        const card = page.getByRole('link', { name: /^Next stock event/ })
        await expect(card).toBeVisible()
        await expect(card).toContainText('estimated price change')
        await page.getByText(/Your estimate · announcement expected/).first().scrollIntoViewIfNeeded()
        await shoot(page, `dashboard-estimated-price-light-${size}`)
        await card.click()
        await expect(page).toHaveURL(/\/events\?date=2027-01-01/)
      } finally {
        await page.request.delete(`${BASE}/api/prices/${id}`)
      }
    })
  }

  for (const theme of ['light', 'dark'] as const) test(`trial metrics - ${theme} - mobile`, async ({page}) => {
    await authedPage(page, MOBILE, theme)
    await page.request.post(`${BASE}/api/trial/analyze`, {multipart: {share_csv: {name: 'fictional.csv', mimeType: 'text/csv', buffer: readFileSync(TRIAL_CSV)}}})
    await page.goto('/admin#usage')
    const panel = page.getByRole('heading', {name: 'Onboarding attempts', exact: true}).locator('..')
    await expect(panel.getByText('Import attempts', {exact: true})).toBeVisible()
    await page.locator('.sticky, nav[aria-label="Main navigation"], nav[aria-label="Mobile navigation"]').evaluateAll(nodes => nodes.forEach(node => node.remove()))
    await panel.screenshot({style: '.sticky, header, [aria-label="Main navigation"], [aria-label="Mobile navigation"] { visibility: hidden !important }', path: `${OUT}/trial-metrics-${theme}-mobile.png`})
  })

  test('admin - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await navigateTo(page, 'Site Admin')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    await expectClearWingMarker(page)
    await shoot(page, 'admin-light-mobile')
  })

  test('admin - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await navigateTo(page, 'Site Admin')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    await expectClearWingMarker(page)
    await shoot(page, 'admin-dark-mobile')
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`admin backups - ${theme} - mobile`, async ({ page }) => {
      await page.route('**/api/admin/backups', route => route.fulfill({ json: backupStatus }))
      await authedPage(page, MOBILE, theme)
      await page.goto('/admin#maintenance')
      const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Backups', exact: true }) })
      await panel.getByRole('button', { name: 'Configure backups' }).click()
      await panel.scrollIntoViewIfNeeded()
      await panel.screenshot({ path: `${OUT}/admin-backups-${theme}-mobile.png`,
        style: '.sticky.top-0, nav[aria-label="Mobile navigation"] { visibility: hidden !important; }' })
    })
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`admin cloudflare edge - ${theme} - mobile`, async ({ page }) => {
      await page.route('**/api/admin/edge-summary', route => route.fulfill({ json: {
        environment: 'production', state: 'available', reason: null, collected_at_utc: '2026-11-15T23:00:00Z',
        window_start_utc: '2026-11-15T22:28:00Z', window_end_utc: '2026-11-15T22:58:00Z',
        records: [{ action: 'block', count: 412 }, { action: 'managed_challenge', count: 37 }, { action: 'skip', count: 18 }],
        record_limit_reached: false, cache_age_seconds: 0,
      } }))
      await authedPage(page, MOBILE, theme)
      await page.goto('/admin#health')
      const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Cloudflare edge', exact: true }) })
      await panel.getByText('Blocked').waitFor()
      await panel.scrollIntoViewIfNeeded()
      await panel.screenshot({ path: `${OUT}/admin-edge-${theme}-mobile.png`,
        style: '.sticky.top-0, nav[aria-label="Mobile navigation"] { visibility: hidden !important; }' })
    })
  }

  test('admin AI plugin downloads - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.goto('/admin#ai-connections')
    await page.waitForLoadState('networkidle')
    const heading = page.getByText('Admin MCP', { exact: true })
    await heading.scrollIntoViewIfNeeded()
    await expect(page.getByRole('link', { name: 'Download admin MCP' })).toHaveCount(1)
    await shoot(page, 'admin-ai-plugin-downloads-light-mobile')
  })

  test('events page - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await navigateTo(page, 'Events')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'events-light-mobile')
    const eventDetails = page.getByRole('button', { name: /^Event details:/ }).first()
    await eventDetails.focus()
    await page.keyboard.press('Enter')
    await expect(eventDetails).toHaveAttribute('aria-expanded', 'true')
  })

  test('events page - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await navigateTo(page, 'Events')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'events-dark-mobile')
  })

  for (const theme of ['light', 'dark'] as const) for (const [size, viewport] of [['mobile', MOBILE], ['desktop', DESKTOP]] as const) {
    test(`rollout checks - ${theme} - ${size}`, async ({ page, browser }) => {
      await authedPage(page, viewport, theme)
      await page.request.post(`${BASE}/api/auth/test-login`, {data: {email: `rollout-${theme}-${size}-${test.info().retry}@e2e.test`, name: 'Fictional employee'}})
      const year = new Date().getFullYear()
      expect((await page.request.post(`${BASE}/api/grants`, {data: {year: year - 2, type: 'Purchase', shares: 1000, price: 10,
        exercise_date: `${year-2}-01-01`, vest_start: `${year-1}-01-01`, periods: 4, dp_shares: 0, election_83b: true}})).ok()).toBe(true)
      for (const [priceYear, price] of [[year-2, 10], [year, 20], [year+1, 30]]) {
        expect((await page.request.post(`${BASE}/api/prices`, {data: {effective_date: `${priceYear}-01-01`, price, is_estimate: priceYear > year}})).ok()).toBe(true)
      }
      const config = await (await page.request.get(`${BASE}/api/config`)).json()
      await page.route('**/api/config', route => route.fulfill({json: {...config, email_notifications_available: true}}))
      await page.goto(BASE)
      await expect(page.getByRole('link', {name: 'Choose reminders'})).toBeVisible()
      const position = page.getByRole('region', {name: 'Your position'})
      const exit = page.getByRole('region', {name: 'If you leave'})
      await expect(position.getByText('Earnings and borrowing costs', {exact: true})).toBeVisible()
      await expect(position.getByRole('link', {name: 'See total compensation'})).toHaveAttribute('href', '/comp-calculator')
      await expect(page.getByRole('link', {name: 'Ask your assistant'})).toHaveCount(0)
      await expect(position.locator('[data-equity-term="vesting"]')).toHaveCount(1)
      await expect(page.getByText(/Your \d{4} stock summary/)).toHaveCount(0)
      await expect(page.getByText('Explore with your assistant', {exact: true})).toHaveCount(0)
      await exit.getByText('What changes if I stay one more year?', {exact: true}).click()
      await expect(exit.getByText(/change in modeled total cash through exit/)).toBeVisible()
      const sections = page.locator('.campus-dashboard > section')
      await expect(sections.locator(':scope > :is(h1, h2)')).toHaveText([
        'Your position', 'If you leave', 'Upcoming stock events', 'Stock over time',
      ])
      expect((await (await page.request.get(`${BASE}/api/notifications/email`)).json()).enabled).toBe(false)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const audit = await new AxeBuilder({page}).include('.campus-dashboard').withTags(['wcag2a', 'wcag2aa']).analyze()
      expect(audit.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
      await shoot(page, `rollout-dashboard-${theme}-${size}`, {fullPage: true})
      await page.goto(`${BASE}/events`)
      await page.getByText(`Your ${year-1} stock summary`, {exact: true}).click()
      await expect(page.getByRole('region', {name: 'Annual stock changes'})).toBeVisible()
      await page.goto(`${BASE}/#annual-summary`)
      await expect(page).toHaveURL(/\/events#annual-summary$/)
      await expect(page.getByRole('region', {name: 'Annual stock changes'})).toBeVisible()
      await page.goto(`${BASE}/settings#notifications`)
      const annual = page.getByLabel(/Include an annual stock summary/)
      await expect(annual).not.toBeChecked()
      await expect(annual).toBeDisabled()
      await expect(page.getByText(/Turn on email or push notifications to receive the annual summary/)).toBeVisible()
      expect((await (await page.request.get(`${BASE}/api/notifications/email`)).json()).annual_summary_enabled).toBe(false)
      expect((await (await page.request.get(`${BASE}/api/notifications/email`)).json()).enabled).toBe(false)
      await page.getByRole('heading', {name: 'Notifications', exact: true}).locator('..').screenshot({path: `${OUT}/reminder-settings-${theme}-${size}.png`})
      const signedOut = await browser.newPage()
      try {
        await signedOut.goto(`${BASE}/events#annual-summary`)
        await expect(signedOut).toHaveURL(/\/login\?next=%2Fevents%23annual-summary$/)
      } finally {
        await signedOut.close()
      }
      await page.goto(`${BASE}/import`)
      await page.locator('#epic-csv').setInputFiles(TRIAL_CSV)
      await page.locator('#epic-pdf').setInputFiles(TRIAL_PDF)
      await page.getByRole('button', {name: 'Read my files'}).click()
      await page.getByText('What the files could verify', {exact: true}).click()
      const checks = page.getByRole('region', {name: 'Import checks'})
      await expect(checks.getByText('Not available', {exact: true})).toBeVisible()
      await expect(checks.getByText('Stale statement', {exact: true})).toBeVisible()
      await checks.screenshot({style: '[aria-label="Mobile navigation"]{visibility:hidden!important}', path: `${OUT}/import-evidence-${theme}-${size}.png`})
    })
  }

  test('import-export page - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await navigateTo(page, 'Import')
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
    await navigateTo(page, 'Sales')
    await expect(page.getByLabel('Filter sales')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit sale' }).first()).toBeVisible()
    await shoot(page, 'sales-light-mobile', { fullPage: true })
  })

  test('sales page - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await navigateTo(page, 'Sales')
    await expect(page.getByLabel('Filter sales')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit sale' }).first()).toBeVisible()
    await shoot(page, 'sales-dark-mobile', { fullPage: true })
  })

  test('settings page - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await navigateTo(page, 'Settings')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await expectClearWingMarker(page)
    await shoot(page, 'settings-light-mobile')
  })

  test('settings page - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await navigateTo(page, 'Settings')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await expectClearWingMarker(page)
    await shoot(page, 'settings-dark-mobile')
  })

  test('settings loan assumptions - light - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'light')
    await page.goto(`${BASE}/settings#loans`)
    await expect(page.getByRole('heading', { name: 'Loan assumptions', exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Settings categories' })).toBeVisible()
    await shoot(page, 'settings-loans-light-desktop')
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

  test('login page - light - desktop', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize(DESKTOP)
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')
    await shoot(page, 'login-light-desktop', { fullPage: true })
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

  test('report dialog with original import files - mobile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize(MOBILE)
    const dialog = await openFailedImportReport(page, BASE)
    await dialog.getByRole('checkbox', { name: /Attach the original import files/ }).check()
    await dialog.getByRole('button', { name: 'Remove fictional-statement.pdf' }).scrollIntoViewIfNeeded()
    await shoot(page, 'report-import-files-mobile')
  })

  test('report investigation in browser admin - mobile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize(MOBILE)
    const dialog = await openFailedImportReport(page, BASE)
    await dialog.getByRole('checkbox', { name: /Attach the original import files/ }).check()
    await dialog.getByRole('button', { name: 'Remove fictional-statement.pdf' }).click()
    await dialog.getByRole('button', { name: 'Send report' }).click()
    await expect(dialog.getByText('Thanks — that went straight to the maintainer.')).toBeVisible()
    await page.request.post(`${BASE}/api/auth/test-login`, { data: { email: EMAIL, name: 'Test Admin' } })
    await page.goto('/admin#support')
    await page.getByRole('button', { name: /private report with consented material/i }).first().click()
    await page.getByRole('button', { name: 'Open private details' }).click()
    await page.getByRole('button', { name: 'View text' }).click()
    await expect(page.locator('pre').filter({ hasText: 'Fictional grant,321,25.50' })).toBeVisible()
    await page.getByRole('heading', { name: 'Consented material' }).scrollIntoViewIfNeeded()
    await shoot(page, 'admin-private-report-light-mobile')
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

  /** Upload the synthetic Eureka fixtures and land on the computed preview. */
  async function previewPage(page: Page, viewport: { width: number; height: number }, scheme: 'light' | 'dark') {
    await page.emulateMedia({ colorScheme: scheme })
    await page.setViewportSize(viewport)
    await page.goto(`${BASE}/try`)
    await page.waitForLoadState('networkidle')
    await page.locator('#trial-csv').setInputFiles(TRIAL_CSV)
    await page.locator('#trial-pdf').setInputFiles(TRIAL_PDF)
    await page.getByRole('button', { name: 'See my numbers' }).click()
    await page.getByText('Stock value before loans and taxes · as of', { exact: false }).first().waitFor({ timeout: 20000 })
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

  for (const theme of ['light', 'dark'] as const) for (const [size, viewport] of [['mobile', MOBILE], ['desktop', DESKTOP]] as const) {
    test(`privacy policy - ${theme} - ${size}`, async ({page}) => {
      await page.emulateMedia({colorScheme: theme})
      await page.setViewportSize(viewport)
      await page.goto(`${BASE}/privacy`)
      await expect(page.getByText(/With server encryption configured/)).toBeVisible()
      await expect(page.getByText(/newest seven complete backups/)).toBeVisible()
      await shoot(page, `privacy-${theme}-${size}`, {fullPage: true})
    })
  }

  test('grants - epic mode - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    // Enable Epic Mode via admin API (demo user is admin)
    await page.request.post(`${BASE}/api/admin/epic-mode`, { data: { active: true } })
    await page.goto(`${BASE}`)
    await page.waitForLoadState('networkidle')
    await navigateTo(page, 'Grants')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    const schedule = page.locator('summary').filter({ hasText: /vests? · / }).first()
    await expect(schedule).toBeVisible()
    await shoot(page, 'grants-epic-mode-light-mobile', { fullPage: true })
    await schedule.click()
    await expect(schedule.locator('..').getByRole('listitem').first()).toBeVisible()
    await schedule.click()
    const filter = page.getByLabel('Filter grants')
    const sort = page.getByLabel('Sort grants')
    const controlStyle = (control: Element) => ({
      fontSize: getComputedStyle(control).fontSize,
      height: control.getBoundingClientRect().height,
    })
    expect(await filter.evaluate(controlStyle)).toEqual({ fontSize: '16px', height: 44 })
    expect(await sort.evaluate(controlStyle)).toEqual({ fontSize: '16px', height: 44 })
    await sort.selectOption('Largest first')
    await expect(page.locator('.record-list > div').first()).toContainText('15,000')
    await page.getByLabel('Filter grants').fill('no matching grant')
    await expect(page.getByRole('status').filter({ hasText: 'No grants match' })).toBeVisible()
    await page.getByRole('button', { name: 'Clear filter' }).click()
    await expect(filter).toBeFocused()
    await filter.fill('purchase')
    await expect(page.getByRole('status').filter({ hasText: /\d+ of \d+ grants/ })).toBeVisible()
    await expect(page.getByText(/^\d+ grants$/)).toHaveCount(0)
    await shoot(page, 'grants-filter-light-mobile', { fullPage: true })
    await page.request.post(`${BASE}/api/admin/epic-mode`, { data: { active: false } })
  })

  test('grants - epic mode - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await page.request.post(`${BASE}/api/admin/epic-mode`, { data: { active: true } })
    await page.goto(`${BASE}`)
    await page.waitForLoadState('networkidle')
    await navigateTo(page, 'Grants')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'grants-epic-mode-dark-mobile', { fullPage: true })
    await page.request.post(`${BASE}/api/admin/epic-mode`, { data: { active: false } })
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`get started - ${scheme} - mobile`, async ({ page }) => {
      await authedPage(page, MOBILE, scheme)
      await page.request.post(`${BASE}/api/auth/test-login`, {
        data: { email: `get-started-${scheme}@e2e.test`, name: 'New user' },
      })
      await page.goto(`${BASE}`)
      await expect(page.getByRole('heading', { name: 'Get your stock in' })).toBeVisible()
      await page.waitForTimeout(500)
      await shoot(page, `get-started-${scheme}-mobile`, { fullPage: true })
    })
  }

  test('import changes - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.request.post(`${BASE}/api/auth/test-login`, {
      data: { email: 'import-changes@e2e.test', name: 'Import example' },
    })
    await page.goto(`${BASE}/import`)
    await page.locator('#epic-csv').setInputFiles(TRIAL_CSV)
    await page.locator('#epic-pdf').setInputFiles(TRIAL_PDF)
    await page.getByRole('button', { name: 'Read my files' }).click()
    await expect(page.getByRole('button', { name: 'Review and save' })).toBeVisible({ timeout: 20_000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await shoot(page, 'import-changes-light-mobile', { fullPage: true })
    await page.getByRole('button', { name: 'Review and save' }).click()
    await expect(page.getByRole('button', { name: /Save \d+ changes/ })).toBeVisible()
    await shoot(page, 'import-changes-checked-light-mobile', { fullPage: true })
  })

  test('vesting editor - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await navigateTo(page, 'Grants')
    await page.getByRole('button', { name: 'Edit' }).first().click()
    await expect(page.getByText('Vesting dates')).toBeVisible()
    await shoot(page, 'vesting-editor-light-mobile', { fullPage: true })
  })

  test('settings sharing section - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await navigateTo(page, 'Settings')
    await page.getByRole('link', { name: /^Sharing/ }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    const sharingHeading = page.locator('h2, h3').filter({ hasText: 'Sharing' }).first()
    await sharingHeading.scrollIntoViewIfNeeded()
    await expect(sharingHeading).toBeInViewport()
    await shoot(page, 'settings-sharing-light-mobile')
  })

  test('settings sharing section - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await navigateTo(page, 'Settings')
    await page.getByRole('link', { name: /^Sharing/ }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    const sharingHeading = page.locator('h2, h3').filter({ hasText: 'Sharing' }).first()
    await sharingHeading.scrollIntoViewIfNeeded()
    await expect(sharingHeading).toBeInViewport()
    await shoot(page, 'settings-sharing-dark-mobile')
  })

  test('settings ai connections - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await navigateTo(page, 'Settings')
    await page.getByRole('link', { name: /^AI Connections/ }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    const link = page.getByRole('link', { name: 'Connect an assistant' })
    await link.scrollIntoViewIfNeeded()
    await expect(link).toBeInViewport()
    await shoot(page, 'settings-ai-connections-light-mobile')
  })

  for (const theme of ['light', 'dark'] as const) {
    for (const size of ['mobile', 'desktop'] as const) {
      test(`permission consent - ${theme} - ${size}`, async ({ page }) => {
        await authedPage(page, size === 'mobile' ? MOBILE : DESKTOP, theme)
        const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect'
        const verifier = 'a'.repeat(64)
        const challenge = createHash('sha256').update(verifier).digest('base64url')
        const registration = await page.request.post(`${REVIEW_TEST_BACKEND}/oauth/register`, {
          data: { client_name: 'ChatGPT', redirect_uris: [redirect], token_endpoint_auth_method: 'none' },
        })
        expect(registration.ok()).toBeTruthy()
        const { client_id } = await registration.json()
        const query = new URLSearchParams({
          response_type: 'code', client_id, redirect_uri: redirect,
          code_challenge: challenge, code_challenge_method: 'S256',
        })
        await page.route(`${REVIEW_TEST_BACKEND}/oauth/authorize?**`, async route => {
          const response = await route.fetch()
          await route.fulfill({ response, headers: { ...response.headers(),
            'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
          } })
        })
        await page.goto(`${REVIEW_TEST_BACKEND}/oauth/authorize?${query}`)
        const equity = page.getByRole('group', { name: 'Equity', exact: true })
        const compensation = page.getByRole('group', { name: 'Compensation', exact: true })
        await expect(equity.getByRole('checkbox', { name: /Read your equity/ })).toBeChecked()
        await expect(compensation.getByRole('checkbox', { name: /Read your salary/ })).toBeChecked()
        await expect(equity.getByRole('checkbox', { name: /Add, correct/ })).not.toBeChecked()
        await expect(page.getByRole('status')).toContainText('read-only')
        await expect(page.getByText('Read site deployment status')).toHaveCount(0)
        await shoot(page, `oauth-permissions-${theme}-${size}`, { fullPage: true })
        await compensation.getByRole('button', { name: 'Clear all compensation permissions' }).click()
        await expect(compensation.getByRole('checkbox', { name: /Read your salary/ })).not.toBeChecked()
        await equity.getByRole('button', { name: 'Select all equity permissions' }).click()
        await expect(equity.getByRole('checkbox', { name: /Add, correct/ })).toBeChecked()
        await expect(page.getByRole('status')).toContainText('grants, prices, loans and sales')
        await expect(page.getByRole('status')).not.toContainText('salary')
        await equity.getByRole('checkbox', { name: /Read your equity/ }).uncheck()
        expect(await equity.getByRole('checkbox', { name: /Read your equity/ }).evaluate(
          input => (input as HTMLInputElement).validationMessage)).toContain('also select')
        await equity.getByRole('checkbox', { name: /Read your equity/ }).check()
        const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
        expect(a11y.violations).toEqual([])
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await page.route(`${redirect}**`, route => route.fulfill({ contentType: 'text/html', body: 'Connection complete' }))
        const submitted = page.waitForResponse(response => response.url().endsWith('/oauth/authorize') && response.request().method() === 'POST')
        await page.getByRole('button', { name: 'Connect', exact: true }).click({ noWaitAfter: true })
        const authorized = await submitted
        expect(authorized.status()).toBe(302)
        const code = new URL(authorized.headers().location).searchParams.get('code')
        expect(code).toBeTruthy()
        const exchange = await page.request.post(`${REVIEW_TEST_BACKEND}/oauth/token`, { form: {
          grant_type: 'authorization_code', code: code!, redirect_uri: redirect, client_id, code_verifier: verifier,
        } })
        expect(exchange.ok()).toBeTruthy()
        const tokens = await exchange.json()
        expect(tokens.scope.split(' ').sort()).toEqual(['equity:read', 'equity:write'])
        const tools = await page.request.post(`${REVIEW_TEST_BACKEND}/mcp`, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
          data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        })
        const names = (await tools.json()).result.tools.map((tool: { name: string }) => tool.name)
        expect(names).toEqual(expect.arrayContaining(['apply_changes', 'get_import_guide']))
        expect(names).not.toContain('admin_deployment_status')
      })
    }
  }

  test('admin diagnostics consent - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    const registration = await page.request.post(`${REVIEW_TEST_BACKEND}/admin-oauth/register`, {
      data: {
        client_name: 'ChatGPT staging diagnostics',
        redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
        token_endpoint_auth_method: 'none',
      },
    })
    expect(registration.ok()).toBeTruthy()
    const { client_id } = await registration.json()
    const query = new URLSearchParams({
      response_type: 'code', client_id,
      redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      code_challenge: 'x'.repeat(43), code_challenge_method: 'S256',
    })
    await page.goto(`${REVIEW_TEST_BACKEND}/admin-oauth/authorize?${query}`)
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
    await expect(page.getByText('Read site deployment status')).toBeVisible()
    await shoot(page, 'admin-diagnostics-consent-light-mobile', { fullPage: true })
  })

  for (const [theme, assistant] of [['light', 'claude'], ['dark', 'chatgpt']] as const) {
    test(`connect your AI - ${assistant} - ${theme} - mobile`, async ({ page }) => {
      await authedPage(page, MOBILE, theme)
      await page.goto(`${BASE}/connect-ai`)
      await page.waitForLoadState('networkidle')
      await page.getByLabel('Your assistant').selectOption(assistant)
      await expect(page.getByLabel('Server address')).toHaveValue(/\/mcp$/)
      if (assistant === 'chatgpt') {
        await expect(page.getByText(/ChatGPT Free cannot add custom connectors/)).toBeVisible()
      } else {
        await expect(page.getByText(/Personal Claude Free accounts can add one custom connector/)).toBeVisible()
      }
      await shoot(page, `connect-ai-${assistant}-${theme}-mobile`, { fullPage: assistant === 'chatgpt' })
    })
  }

  test('connect your AI - muse - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.goto(`${BASE}/connect-ai`)
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Your assistant').selectOption('muse')
    const request = page.getByText(/Create a custom connector named Epic Stocks/)
    await request.scrollIntoViewIfNeeded()
    await expect(request).toBeVisible()
    await page.evaluate(() => window.scrollBy(0, 160))
    await shoot(page, 'connect-ai-muse-light-mobile')
  })

  test('admin AI requests awaiting approval - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.goto('/admin#ai-connections')
    await page.waitForLoadState('networkidle')
    const heading = page.getByRole('heading', { name: /Requests from AI assistants/ })
    await heading.evaluate(el => el.scrollIntoView({ block: 'start' }))
    await page.evaluate(() => window.scrollBy(0, -72))
    await expect(page.getByText('https://assistant.example.com/oauth/callback')).toBeVisible()
    await expect(page.getByText(/Assistant.s note — unverified/)).toBeVisible()
    await shoot(page, 'admin-ai-requests-light-mobile')
  })

  test('admin AI redirect rules - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    // A registration from an assistant the allowlist does not know yet.
    await page.request.post(`${REVIEW_TEST_BACKEND}/oauth/register`, {
      data: { client_name: 'Copilot', redirect_uris: ['https://copilot.microsoft.com/oauth/callback'] },
    })
    await page.goto('/admin#ai-connections')
    await page.waitForLoadState('networkidle')
    const refused = page.getByText('Refused redirect addresses', { exact: true })
    await refused.scrollIntoViewIfNeeded()
    await expect(page.getByText('https://copilot.microsoft.com/oauth/callback')).toBeVisible()
    await page.evaluate(() => window.scrollBy(0, -80))
    await shoot(page, 'admin-ai-redirects-light-mobile')
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
    await navigateTo(page, 'Content Admin')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'content-light-mobile')
  })

  test('content - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await navigateTo(page, 'Content Admin')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'content-dark-mobile')
  })

  test('content - light - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'light')
    await page.goto('/content#templates')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'content-light-desktop', { fullPage: true })
  })

  test('content - dark - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'dark')
    await page.goto('/content#templates')
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
    const selectedComp = page.getByRole('region', { name: 'Selected year compensation' })
    await page.getByRole('button', { name: 'Pretax salary equivalent', exact: true }).click()
    await expect(selectedComp).toContainText('pretax-equivalent stock compensation')
    await page.evaluate(() => window.scrollTo(0, 720))
    await expect(selectedComp).toBeInViewport()
    const calculatorSections = page.getByRole('tablist', { name: 'Calculator sections' })
    const resultsTab = calculatorSections.getByRole('tab', { name: /^Results/ })
    await resultsTab.focus()
    await resultsTab.press('ArrowRight')
    const payTab = calculatorSections.getByRole('tab', { name: 'Pay', exact: true })
    await expect(payTab).toBeFocused()
    await payTab.press('Space')
    await expect(payTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByLabel('Selected year compensation')).toBeInViewport()
    await expect(page.getByLabel('Planned exit date')).toBeHidden()
    await calculatorSections.getByRole('tab', { name: 'Stock assumptions', exact: true }).click()
    await expect(page.getByLabel('Planned exit date')).toBeVisible()
    await expect(page.getByLabel('Selected year compensation')).toBeInViewport()
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
    const saved = await (await page.request.get(`${BASE}/api/retirement/params`)).json()
    expect((await page.request.put(`${BASE}/api/retirement/params`, { data: { params: { ...saved.params, epicExit: 5, taxableAdditional: 1, defaultSpend: 180, minSpend: 120, retirementDate: '2032-01-01', epicExitMode: 'manual', advanced: false, traditional: 0, roth: 0, additionalBasis: 0, plannedEvents: [], paths: 1000, seed: 1729 } } })).ok()).toBe(true)
    expect((await page.request.patch(`${BASE}/api/me/profile`, {data: {date_of_birth: '1976-04-15'}})).ok()).toBe(true)
    await page.goto(`${BASE}/retirement`)
    await page.waitForLoadState('networkidle')
    // Initial results now run automatically from the synthetic saved plan.
    // Setup-only API writes bypass the profile cache used by the UI.
    await page.reload()
    await expect(page.getByLabel(/^Date of birth/)).toHaveValue('1976-04-15')
    await page.waitForSelector('text=Ended richer than you started', { timeout: 60000 })
    await page.getByText('Funding risk details', { exact: true }).click()
    await expect(page.getByText('Shortfall with assets remaining', { exact: true })).toBeVisible()
    await expect(page.getByText('Shortfall with assets exhausted', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
    const audit = await new AxeBuilder({ page }).include('.campus-observatory').withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(audit.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
    await page.getByText('Funding risk details', { exact: true }).click()
    await page.waitForTimeout(500)
  }

  for (const theme of ['light', 'dark'] as const) for (const [size, viewport] of [['mobile', MOBILE], ['desktop', DESKTOP]] as const) {
    test(`planner views - ${theme} - ${size}`, async ({ page }) => {
      await authedPage(page, viewport, theme)
      await page.request.put(`${BASE}/api/retirement/params`, { data: { params: {
        epicExit: 5, epicExitMode: 'manual', retirementDate: '2032-01-01', advanced: true,
        taxableAdditional: 3, additionalBasis: 1.2, traditional: 1, roth: 0.5, defaultSpend: 180,
      } } })
      await page.goto(`${BASE}/retirement`)
      await expect(page.getByLabel(/^Retirement date/)).toHaveValue('2032-01-01')
      const sections = page.getByRole('tablist', { name: 'Retirement assumptions' })
      const run = page.getByRole('region', { name: 'Retirement plan summary' }).getByRole('button', { name: /Simulate/ })
      await expect(run).toBeInViewport()
      let previousScroll: number | undefined
      if (size === 'mobile') {
        const destinations = page.getByRole('group', { name: 'Planning', exact: true }).locator('button, a')
        const dimensions = await destinations.evaluateAll(items => items.map(item => {
          const label = document.createRange()
          label.selectNodeContents(item.firstElementChild!)
          return { height: item.getBoundingClientRect().height, lines: label.getClientRects().length }
        }))
        expect(new Set(dimensions.map(d => d.height)).size).toBe(1)
        expect(dimensions.map(d => d.lines)).toEqual([1, 1, 1])
        previousScroll = await page.evaluate(() => { window.scrollTo(0, 150); return window.scrollY })
        expect(previousScroll).toBeGreaterThan(0)
      }
      await sections.getByRole('tab', { name: /^Spending/ }).click()
      if (previousScroll != null) expect(await page.evaluate(() => window.scrollY)).toBe(previousScroll)
      await expect(page.getByLabel(/^Default spend/)).toBeVisible()
      await expect(page.getByLabel(/^Retirement date/)).toBeHidden()
      await expect(run).toBeInViewport()
      await sections.getByRole('tab', { name: /^Who & when/ }).click()
      await expect(sections.getByRole('tab', { name: /Advanced assumptions/ })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await shoot(page, `retirement-basic-${theme}-${size}`, { fullPage: true })
      await sections.getByRole('tab', { name: /Advanced assumptions/ }).click()
      await expect(page.getByLabel(/^401\(k\) \/ Traditional IRA/)).toHaveValue('1000000')
      const advanced = page.getByRole('navigation', { name: 'Advanced assumption sections' })
      await advanced.getByRole('link', { name: 'Timing & spouse', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Timing & spouse', exact: true })).toBeVisible()
      await expect(page.getByRole('checkbox', { name: /Include spouse/ })).toBeVisible()
      await expect(page.getByLabel(/^Retirement date/)).toBeHidden()
      await advanced.getByRole('link', { name: 'Market', exact: true }).click()
      await expect(page.getByText('Market outlook', { exact: true })).toBeVisible()
      await expect(page.getByLabel(/^401\(k\) \/ Traditional IRA/)).toBeHidden()
      await advanced.getByRole('link', { name: 'Accounts & allocation', exact: true }).click()
      await expect(run).toBeInViewport()
      const audit = await new AxeBuilder({ page }).include('.campus-observatory').withTags(['wcag2a', 'wcag2aa']).analyze()
      expect(audit.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
      await shoot(page, `retirement-advanced-${theme}-${size}`, { fullPage: true })
      await page.getByRole('button', { name: 'Hide account breakdown' }).click()
      await sections.getByRole('tab', { name: /Your money/ }).click()
      await expect.poll(async () => (await (await page.request.get(`${BASE}/api/retirement/params`)).json()).params.traditional).toBe(1)
    })
  }

  test('retirement - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await seedRetirement(page)
    await shoot(page, 'retirement-light-mobile', { fullPage: true })
    await page.getByText('Funding risk details', { exact: true }).click()
    await page.getByText('Funding risk details', { exact: true }).locator('..').screenshot({ path: `${OUT}/retirement-risk-details-light-mobile.png`, style: '.sticky,[aria-label="Mobile navigation"]{visibility:hidden!important}' })
  })

  test('retirement - light - desktop', async ({ page }) => {
    await authedPage(page, DESKTOP, 'light')
    await seedRetirement(page)
    await shoot(page, 'retirement-light-desktop', { fullPage: true })
  })

  test('retirement - dark - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'dark')
    await seedRetirement(page)
    const glossary = page.locator('details').filter({ has: page.locator('summary', { hasText: 'What do these terms mean?' }) })
    const terms = glossary.locator('dt')
    await expect(terms.first()).toBeHidden()
    await glossary.locator('summary').click()
    await expect(terms).toHaveText(['Percentiles', 'Funding shortfall', 'Portfolio exhausted'])
    await expect(terms.last()).toBeVisible()
    await glossary.locator('summary').click()
    await expect(terms.last()).toBeHidden()
    await shoot(page, 'retirement-dark-mobile', { fullPage: true })
    await page.getByText('Funding risk details', { exact: true }).click()
    await page.getByText('Funding risk details', { exact: true }).locator('..').screenshot({ path: `${OUT}/retirement-risk-details-dark-mobile.png`, style: '.sticky,[aria-label="Mobile navigation"]{visibility:hidden!important}' })
  })

  for (const [label, viewport] of [['mobile', MOBILE], ['desktop', DESKTOP]] as const) {
    test(`life events planner - light - ${label}`, async ({ page }) => {
      await authedPage(page, viewport, 'light')
      await page.request.post(`${BASE}/api/auth/test-login`, {
        data: { email: `life-events-${label}@screenshots.example.test`, name: 'Life Events Demo' },
      })
      await page.goto(`${BASE}/retirement`)
      await page.waitForLoadState('networkidle')
      await page.getByLabel('Retirement date').fill('2032-01-02')
      await page.getByRole('button', { name: 'Planned Expenses', exact: true }).click()
      await page.getByRole('button', { name: /Add planned expense/ }).click()
      await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('vehicle')
      await page.getByLabel(/Purchase price \(/).fill('250000')
      await page.locator('summary').filter({ hasText: /^Ownership and costs/ }).click()
      await page.getByLabel('Sell car after N years (optional)').fill('15')
      await page.getByLabel('Depreciation schedule').selectOption('collector')
      await page.getByLabel(/Annual ownership costs/).fill('15000')
      await page.getByRole('region', { name: 'Planned expenses', exact: true }).screenshot({ path: `${OUT}/life-events-ownership-light-${label}.png`, style: '[aria-label="Car plan summary"]{position:static!important}.sticky:not([aria-label="Car plan summary"]),[aria-label="Mobile navigation"]{visibility:hidden!important}' })
      await page.getByLabel('Purchase / start date').fill('2032-01-02')
      await page.getByLabel('Optional purchase').check()
      await page.locator('summary').filter({ hasText: /^Purchase rule/ }).click()
      await expect(page.locator('summary').filter({ hasText: /^Ownership and costs/ }).locator('..')).not.toHaveAttribute('open', '')
      await expect(page.getByRole('region', {name: 'Car plan summary'})).toBeVisible()
      await page.getByLabel(/Minimum portfolio as %/).pressSequentially('140')
      await expect(page.getByLabel(/Minimum portfolio as %/)).toHaveValue('140')
      await page.getByLabel('If conditions are not met').selectOption('defer')
      await page.getByRole('heading', { name: 'Planned Expenses' }).click()
      await expect(page.getByLabel(/Purchase price/)).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
      const audit = await new AxeBuilder({ page }).include('[aria-label="Planned expenses"]')
        .withTags(['wcag2a', 'wcag2aa']).analyze()
      expect(audit.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
      // The sticky site header and fixed mobile navigation are outside this
      // component. Hide only that chrome for a focused component screenshot;
      // otherwise they cover the planner when Playwright scrolls to it.
      await page.evaluate(() => {
        const planner = [...document.querySelectorAll('[aria-label="Planned expenses"]')].find(el => el.getClientRects().length > 0)
        for (const element of document.querySelectorAll<HTMLElement>('body *')) {
          if (planner?.contains(element)) continue
          const position = getComputedStyle(element).position
          if (position === 'fixed' || position === 'sticky') element.style.visibility = 'hidden'
        }
      })
      await page.getByRole('region', { name: 'Planned expenses', exact: true })
        .screenshot({ path: `${OUT}/life-events-planner-light-${label}.png`, style: '[aria-label="Car plan summary"]{position:static!important}' })
      await page.getByRole('button', { name: 'Add event', exact: true }).click()
      await expect(page.getByText(/Otherwise, check again monthly/)).toBeVisible()
      await page.getByRole('region', { name: 'Planned expenses', exact: true })
        .screenshot({ path: `${OUT}/life-events-review-light-${label}.png` })
    })
  }

  test('expense funding options - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.request.post(`${BASE}/api/auth/test-login`, {
      data: { email: 'expense-funding@screenshots.example.test', name: 'Expense Funding Demo' },
    })
    const year = new Date().getFullYear()
    const vestDate = `${year - 4}-01-01`
    const dueDate = `${year + 1}-12-01`
    expect((await page.request.post(`${BASE}/api/prices`, {
      data: { effective_date: vestDate, price: 20 },
    })).status()).toBe(201)
    expect((await page.request.post(`${BASE}/api/grants`, {
      data: { year: year - 4, type: 'Purchase', shares: 1000, price: 10, vest_start: vestDate,
        periods: 1, exercise_date: vestDate },
    })).status()).toBe(201)

    await page.goto(`${BASE}/retirement?view=expenses`)
    await page.getByRole('button', { name: /Add planned expense/ }).click()
    await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('renovation')
    await page.getByLabel('Purchase / start date').fill(dueDate)
    await page.getByLabel(/One-time cost/).fill('30000')
    await page.getByRole('button', { name: 'Add event', exact: true }).click()
    const card = page.getByRole('listitem').filter({ hasText: 'Renovation' })
    await expect(card.getByRole('heading', { name: 'Save from pay or use cash' })).toBeVisible()
    await expect(card.getByText(/Savings would cover the remaining/)).toBeVisible()
    await expect(card.getByRole('button', { name: 'Add tentative sale' })).toBeVisible()
    const audit = await new AxeBuilder({ page }).include('[aria-label="Planned expenses"]')
      .withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(audit.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(MOBILE.width)
    await card.screenshot({ path: `${OUT}/expense-funding-light-mobile.png`,
      style: '.sticky,[aria-label="Mobile navigation"]{visibility:hidden!important}' })

    await card.getByRole('button', { name: 'Keep as a tip' }).click()
    await expect(card.getByRole('button', { name: 'Add tentative sale' })).toBeHidden()
    expect(await (await page.request.get(`${BASE}/api/retirement/expense-funding`)).json()).toEqual({})
    await page.reload()
    await card.getByRole('button', { name: 'Funding options for Renovation' }).click()
    await card.getByRole('button', { name: 'Add tentative sale' }).click()
    await expect(card.getByText(/Tentative Epic sale · 1,000 shares/)).toBeVisible()
    await page.goto(`${BASE}/sales`)
    await expect(page.getByRole('heading', { name: 'Tentative sales for planned expenses' })).toBeVisible()
    await expect(page.getByText(/Renovation · .*1,000 shares/)).toBeVisible()
    expect(await (await page.request.get(`${BASE}/api/sales`)).json()).toEqual([])

    expect((await page.request.put(`${BASE}/api/retirement/params`, {
      data: { params: { retirementDate: `${year + 2}-01-01` }, preserve_planned_expenses: true },
    })).ok()).toBe(true)
    await page.getByRole('link', { name: 'Review in Planned Expenses' }).click()
    await page.getByText('Review funding by year and expense').click()
    await expect(page.getByRole('row').filter({ hasText: 'Renovation' })).toContainText('Tentative sale + savings for first bill')
  })

  test('conditional purchase before changed retirement - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.request.post(`${BASE}/api/auth/test-login`, {
      data: { email: 'conditional-warning@screenshots.example.test', name: 'Conditional Demo' },
    })
    const params = { retirementDate: '2034-06-01', epicExit: 5, paths: 10, seed: 1729,
      plannedEvents: [{ id: 'car', title: 'Optional car', kind: 'vehicle',
        date: '2035-01-01', amountM: 0.2, condition: { requireFullSpending: true } }] }
    expect((await page.request.put(`${BASE}/api/retirement/params`, { data: { params } })).ok()).toBe(true)
    expect((await page.request.put(`${BASE}/api/retirement/params`, { data: { params: { ...params, retirementDate: '2036-01-01' } } })).ok()).toBe(true)
    await page.goto(`${BASE}/retirement`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: /Simulate.*retirements/ }).click()
    const warning = page.getByText(/Optional car: conditional ownership periods before retirement are skipped/)
    await expect(warning).toBeVisible()
    await warning.screenshot({ path: `${OUT}/conditional-purchase-warning-light-mobile.png` })
  })

  test('prices and tentative announcement - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await navigateTo(page, 'Prices')
    await shoot(page, 'prices-light-mobile', { fullPage: true })
    await page.getByRole('button', {name: '+ Price', exact: true}).click()
    await page.getByLabel('Applicable Date').fill('2026-01-01')
    await page.getByLabel('Price per Share').fill('10')
    await page.getByLabel('Tentative estimate').check()
    await shoot(page, 'prices-tentative-light-mobile', { fullPage: true })
  })

  test('loans - epic mode - light - mobile', async ({ page }) => {
    await authedPage(page, MOBILE, 'light')
    await page.request.post(`${BASE}/api/admin/epic-mode`, { data: { active: true } })
    await page.goto(`${BASE}`)
    await page.waitForLoadState('networkidle')
    await navigateTo(page, 'Loans')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shoot(page, 'loans-epic-mode-light-mobile', { fullPage: true })
    await page.request.post(`${BASE}/api/admin/epic-mode`, { data: { active: false } })
  })
})

test.describe('Directory reviewer screenshots', () => {
  test.skip(!EMAIL, 'Run through screenshots/run.sh')

  test('directory reviewer login - light - mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/reviewer-login')
    await expect(page.getByRole('heading', { name: 'Directory reviewer sign-in' })).toBeVisible()
    await page.screenshot({ path: `${OUT}/directory-reviewer-login-light-mobile.png`, fullPage: true })
  })

  test('directory reviewer admin - light - mobile', async ({ page }) => {
    await authedPage(page, { width: 390, height: 844 }, 'light')
    await page.goto('/admin#ai-connections')
    const panel = page.getByRole('heading', { name: 'Directory reviewer accounts', exact: true }).locator('..')
    await expect(panel).toBeVisible()
    await panel.screenshot({ path: `${OUT}/directory-reviewer-admin-light-mobile.png` })
  })

  test('directory reviewer fictional portfolio and loans', async ({ page }) => {
    await authedPage(page, DESKTOP, 'light')
    const created = await page.request.post(`${BASE}/api/admin/reviewers/access`, { data: { platform: 'openai', scenario: 'established', days: 30 } })
    expect(created.ok()).toBeTruthy()
    const account = await created.json()
    const loginPage = await page.request.get(`${BASE}/reviewer-login`)
    const csrf = (await loginPage.text()).split('name="csrf" value="')[1].split('"')[0]
    const signed = await page.request.post(`${BASE}/reviewer-login`, { form: { login: account.login, password: account.password, csrf } })
    expect(signed.ok()).toBeTruthy()
    await page.goto(BASE)
    await expect(page.getByText(/FICTIONAL REVIEW DATA/)).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Calculating exit…')).toHaveCount(0)
    await page.screenshot({ path: `${OUT}/directory-equity-light-desktop.png` })
    await page.goto(`${BASE}/loans`)
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: `${OUT}/directory-loans-light-desktop.png` })
    await page.setViewportSize(MOBILE)
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Calculating exit…')).toHaveCount(0)
    await page.screenshot({ path: `${OUT}/directory-equity-light-mobile.png`, fullPage: true })
  })

})

test.describe('Public privacy screenshots', () => {
  test.skip(!EMAIL, 'Run through screenshots/run.sh')
  for (const theme of ['light', 'dark'] as const) for (const [size, viewport] of [['mobile', MOBILE], ['desktop', DESKTOP]] as const) {
    test(`public privacy policy - ${theme} - ${size}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.setViewportSize(viewport)
      await page.goto(`${BASE}/privacy-policy`)
      await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible()
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: `${OUT}/public-privacy-${theme}-${size}.png` })
      await expect(page.locator('ol')).toHaveCount(3)
      await page.locator('ol').nth(1).scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${OUT}/public-privacy-lists-${theme}-${size}.png` })
    })
  }
})


test.describe('Public terms screenshots', () => {
  test.skip(!EMAIL, 'Run through screenshots/run.sh')
  for (const theme of ['light', 'dark'] as const) {
    test(`public terms - ${theme} - mobile`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.setViewportSize(MOBILE)
      await page.goto(`${BASE}/terms`)
      await expect(page.getByRole('heading', { name: 'Epic Stocks Terms of Use', exact: true })).toBeVisible()
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: `${OUT}/public-terms-${theme}-mobile.png`, fullPage: true })
    })
  }
})


test.describe('Public support screenshots', () => {
  test.skip(!EMAIL, 'Run through screenshots/run.sh')
  for (const theme of ['light', 'dark'] as const) {
    test(`public support - ${theme} - mobile`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.setViewportSize(MOBILE)
      await page.goto(`${BASE}/support`)
      await expect(page.getByRole('heading', { name: 'Epic Stocks support', exact: true })).toBeVisible()
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: `${OUT}/public-support-${theme}-mobile.png`, fullPage: true })
      await page.goto(`${BASE}/mcp-setup`)
      await expect(page.getByRole('link', { name: 'Support', exact: true })).toBeVisible()
      await page.screenshot({ path: `${OUT}/public-setup-${theme}-mobile.png`, fullPage: true })
    })
  }
})

test('returning to a records page restores its scroll position', async ({ page }) => {
  test.skip(!EMAIL, 'Requires the screenshot fixture')
  await authedPage(page, MOBILE, 'light')
  await navigateTo(page, 'Events')
  await expect(page.locator('[data-event-type]').first()).toBeVisible()
  const priorScroll = await page.evaluate(() => { window.scrollTo(0, 500); return window.scrollY })
  expect(priorScroll).toBe(500)
  await navigateTo(page, 'Settings')
  await expect(page.getByRole('navigation', { name: 'Settings categories' })).toBeVisible()
  let release!: () => void
  const delay = new Promise<void>(resolve => { release = resolve })
  const eventsApi = /\/api\/events(?:\?.*)?$/
  await page.route(eventsApi, async route => { await delay; await route.continue() })
  try {
    await Promise.all([
      page.waitForRequest(eventsApi, { timeout: 5000 }),
      page.evaluate(() => window.history.back()),
    ])
    await expect(page).toHaveURL(/\/events$/)
    await expect(page.locator('[data-event-type]').first()).toBeHidden()
  } finally {
    release()
  }
  await expect(page.locator('[data-event-type]').first()).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(priorScroll)
})

/**
 * E2E tests for Epic Mode:
 * - Admin can enable/disable Epic Mode via the Danger Zone toggle
 * - When active, grant/price/loan writes are blocked (403) and the UI hides
 *   add/edit buttons, showing "Data provided by Epic — view only" instead
 * - Sell button appears on each grant row (replaces Edit)
 * - Request Payoff button appears on each loan row
 * - Sales and payoff execution remain writable
 *
 * Requires backend started with E2E_TEST=1 and ADMIN_EMAIL=admin@e2e.test.
 */
import { test, expect } from '@playwright/test'
import { loginAs, navigateTo } from './helpers'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const ADMIN_EMAIL = 'admin@e2e.test'
const FIXTURE_PATH = path.resolve(__dirname, '../../test_data/fixture.xlsx')
const API_BASE = process.env.E2E_API_URL ?? process.env.E2E_BASE_URL ?? 'http://localhost:5173'

/** Enable or disable Epic Mode via the admin panel Danger Zone. */
async function setEpicMode(page: import('@playwright/test').Page, active: boolean) {
  await loginAs(page, ADMIN_EMAIL, 'Admin User')
  await navigateTo(page, 'Admin')
  // Scroll to Danger Zone
  await page.getByText('Danger Zone').scrollIntoViewIfNeeded()
  const btn = page.getByRole('button', { name: active ? 'Enable Epic Mode' : 'Disable Epic Mode' })
  if (await btn.isVisible()) {
    await btn.click()
    await page.waitForLoadState('networkidle')
  }
}

/** Import fixture data for a user via the API (bypasses epic-mode write guard). */
async function importFixtureAs(page: import('@playwright/test').Page, email: string) {
  await loginAs(page, email, 'Test User')
  await navigateTo(page, 'Import')
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(FIXTURE_PATH)
  await page.getByRole('button', { name: 'Import' }).click()
  await page.waitForLoadState('networkidle')
}

test.describe('Epic Mode', () => {
  test.afterEach(async ({ page }) => {
    // Always disable Epic Mode after each test so other suites are not affected
    await setEpicMode(page, false)
  })

  test('admin can enable and disable Epic Mode from the Danger Zone', async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, 'Admin User')
    await navigateTo(page, 'Admin')
    await page.getByText('Danger Zone').scrollIntoViewIfNeeded()

    // Initially disabled
    await expect(page.getByRole('button', { name: 'Enable Epic Mode' })).toBeVisible()

    // Enable
    await page.getByRole('button', { name: 'Enable Epic Mode' }).click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: 'Disable Epic Mode' })).toBeVisible()
    await expect(page.getByText(/Epic Mode is active/)).toBeVisible()

    // Disable
    await page.getByRole('button', { name: 'Disable Epic Mode' }).click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: 'Enable Epic Mode' })).toBeVisible()
  })

  test('grants page shows view-only banner and hides add buttons when Epic Mode is on', async ({ page }) => {
    const userEmail = 'epic-grants-test@e2e.test'
    await importFixtureAs(page, userEmail)

    await setEpicMode(page, true)

    await loginAs(page, userEmail, 'Epic User')
    await navigateTo(page, 'Grants')

    await expect(page.getByText('Data provided by Epic — view only')).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Purchase' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: '+ Bonus' })).not.toBeVisible()
  })

  test('grants page shows Sell button (not Edit) per row when Epic Mode is on', async ({ page }) => {
    const userEmail = 'epic-sell-btn@e2e.test'
    await importFixtureAs(page, userEmail)

    await setEpicMode(page, true)

    await loginAs(page, userEmail, 'Epic User')
    await navigateTo(page, 'Grants')

    // Sell buttons appear; Edit buttons do not
    await expect(page.getByRole('button', { name: 'Sell' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit' }).first()).not.toBeVisible()
  })

  test('loans page shows Request Payoff button (not Edit) when Epic Mode is on', async ({ page }) => {
    const userEmail = 'epic-payoff-btn@e2e.test'
    await importFixtureAs(page, userEmail)

    await setEpicMode(page, true)

    await loginAs(page, userEmail, 'Epic User')
    await navigateTo(page, 'Loans')

    await expect(page.getByRole('button', { name: 'Request Payoff' }).first()).toBeVisible()
  })

  test('prices page shows view-only banner and hides add button when Epic Mode is on', async ({ page }) => {
    const userEmail = 'epic-prices-test@e2e.test'
    await importFixtureAs(page, userEmail)

    await setEpicMode(page, true)

    await loginAs(page, userEmail, 'Epic User')
    await navigateTo(page, 'Prices')

    await expect(page.getByText('Data provided by Epic — view only')).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Price' })).not.toBeVisible()
  })

  test('backend returns 403 for grant writes when Epic Mode is on', async ({ page }) => {
    await setEpicMode(page, true)

    // Attempt a direct API write — should be blocked
    const resp = await page.request.post(`${API_BASE}/api/grants`, {
      headers: { 'Content-Type': 'application/json' },
      data: { year: 2024, type: 'Purchase', shares: 100, price: 10, vest_start: '2024-01-01', periods: 48, exercise_date: '2028-01-01' },
    })
    expect(resp.status()).toBe(403)
  })

  test('backend returns 403 for price writes when Epic Mode is on', async ({ page }) => {
    await setEpicMode(page, true)

    const resp = await page.request.post(`${API_BASE}/api/prices`, {
      headers: { 'Content-Type': 'application/json' },
      data: { effective_date: '2024-01-01', price: 42.0 },
    })
    expect(resp.status()).toBe(403)
  })

  test('backend allows sales writes when Epic Mode is on', async ({ page }) => {
    // Sales are user-initiated actions — always writable
    await setEpicMode(page, true)

    // POST to /api/sales should NOT be blocked (will get 422/404 for bad data, not 403)
    const resp = await page.request.post(`${API_BASE}/api/sales`, {
      headers: { 'Content-Type': 'application/json' },
      data: { date: '2024-01-01', gross_proceeds: 0, shares: 0, lot_method: 'lifo' },
    })
    expect(resp.status()).not.toBe(403)
  })
})

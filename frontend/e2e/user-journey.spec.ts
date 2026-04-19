import { test, expect } from '@playwright/test'
import { loginAs, navigateTo, resetUserData } from './helpers'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test.describe('Sales journey', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'sales@test.com', 'Sales User')
    await resetUserData(page)
    // Import fixture data so there are vesting events to sell against
    // Uncheck "generate payoff sales" so the sales list starts empty
    await navigateTo(page, 'Import')
    await page.locator('input[type="checkbox"]').uncheck()
    const fixtureFile = path.resolve(__dirname, '../../test_data/fixture.xlsx')
    await page.locator('input[type="file"]').setInputFiles(fixtureFile)
    await expect(page.getByText('Data for each imported sheet will be replaced')).toBeVisible()
    await page.getByRole('button', { name: 'Import' }).click()
    await expect(page.getByText('Imported')).toBeVisible({ timeout: 10000 })
  })

  test('record a sale and view tax breakdown', async ({ page }) => {
    // Navigate to Sales
    await navigateTo(page, 'Sales')
    await expect(page.getByText('No sales recorded yet')).toBeVisible()

    // Add a sale — form opens in Plan Sale mode (today's date)
    await page.getByRole('button', { name: '+ Sale' }).click()
    await expect(page.getByRole('heading', { name: 'Plan Sale' })).toBeVisible()

    // Set a past date — title switches to Record Sale
    await page.getByLabel('Sale Date').fill('2026-03-01')
    await expect(page.getByRole('heading', { name: 'Record Sale' })).toBeVisible()

    // Switch to # Shares mode and fill shares
    await page.getByRole('button', { name: '# Shares' }).click()
    await page.getByLabel('Shares to sell').fill('100')
    await page.getByLabel('Price per Share').fill('25.00')
    await page.getByLabel('Notes (optional)').fill('Test sale')
    await page.getByRole('button', { name: 'Record sale' }).click()

    // Back to list with 1 sale
    await expect(page.getByText('1 sales')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('2026-03-01')).toBeVisible()

    // Tax breakdown auto-expands after save
    await expect(page.getByText('Estimated Tax Breakdown')).toBeVisible()
    await expect(page.getByText('Gross proceeds').first()).toBeVisible()
    await expect(page.getByText('Estimated total tax').first()).toBeVisible()

    // Check gross proceeds = 100 * 25.00 = $2,500
    await expect(page.getByText('$2,500').first()).toBeVisible()
  })

  test('tapping tax cell shows breakdown for existing sale', async ({ page }) => {
    // Create a sale via API (session cookie is automatic via page.request)
    const resp = await page.request.post('/api/sales', {
      data: { date: '2026-01-15', shares: 50, price_per_share: 20.0, notes: '' },
    })
    expect(resp.ok()).toBeTruthy()

    await navigateTo(page, 'Sales')
    await expect(page.getByText('1 sales')).toBeVisible()

    // Wait for any eager-loading state to resolve, then tap the tax cell
    const taxCellButton = page.getByRole('button', { name: /tax breakdown/i }).first()
    await expect(taxCellButton).toBeVisible({ timeout: 5000 })
    await taxCellButton.click()
    await expect(page.getByText('Estimated Tax Breakdown')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Gross proceeds').first()).toBeVisible()
  })

  test('edit and delete sale', async ({ page }) => {
    // Create a sale via API
    const resp = await page.request.post('/api/sales', {
      data: { date: '2026-02-01', shares: 200, price_per_share: 30.0, notes: 'To delete' },
    })
    expect(resp.ok()).toBeTruthy()

    await navigateTo(page, 'Sales')
    await expect(page.getByText('2026-02-01')).toBeVisible()

    // Edit it via pencil icon
    await page.getByRole('button', { name: 'Edit sale' }).first().click()
    await expect(page.getByText('Edit Sale')).toBeVisible()
    await page.getByLabel('Shares to sell').fill('250')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('1 sales')).toBeVisible()

    // Delete via pencil → edit form → Delete sale button
    page.on('dialog', d => d.accept())
    await page.getByRole('button', { name: 'Edit sale' }).first().click()
    await expect(page.getByText('Edit Sale')).toBeVisible()
    await page.getByRole('button', { name: 'Delete sale' }).click()
    await expect(page.getByText('No sales recorded yet')).toBeVisible({ timeout: 5000 })
  })

  test('events page shows tax for vesting events', async ({ page }) => {
    await navigateTo(page, 'Events')
    await expect(page.getByText('Events Timeline')).toBeVisible()
    // Tax amounts should be visible for vesting events (in column header on desktop, inline on mobile cards)
    await expect(page.getByText('Tax').first()).toBeVisible({ timeout: 5000 })
    // Bonus/Free grants in the fixture are 83(b)-elected, so vesting tax shows
    // as a violet "unrealized gains" indicator rather than orange.
    const taxCells = page.locator('span.text-violet-700, span.text-orange-700')
    await expect(taxCells.first()).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Full user journey', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'journey@test.com', 'Journey User')
    await resetUserData(page)
  })

  test('import xlsx → dashboard → events → add price → export', async ({ page }) => {
    // Verify dashboard loads (empty state shows wizard)
    await expect(page.getByText("Let's set up your equity tracker.")).toBeVisible()

    // Navigate to Import page
    await navigateTo(page, 'Import')
    await expect(page.getByText('Import from Excel')).toBeVisible()

    // Upload fixture.xlsx (no payoff sales — keeps event count at the known-good 89)
    const fixtureFile = path.resolve(__dirname, '../../test_data/fixture.xlsx')
    const fileInput = page.locator('input[type="file"]')
    await page.locator('input[type="checkbox"]').uncheck()
    await fileInput.setInputFiles(fixtureFile)

    // Confirm destructive import
    await expect(page.getByText('Data for each imported sheet will be replaced')).toBeVisible()
    await page.getByRole('button', { name: 'Import' }).click()

    // Wait for success message
    await expect(page.getByText('Imported')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('12 grants')).toBeVisible()
    await expect(page.getByText('21 loans')).toBeVisible()
    await expect(page.getByText('8 prices')).toBeVisible()

    // Navigate to Dashboard and verify data loaded
    await navigateTo(page, 'Dashboard')
    await page.waitForLoadState('networkidle')

    // Dashboard cards should show Vested Shares > 0
    const sharesCard = page.getByText('Vested Shares', { exact: true }).locator('..')
    await expect(sharesCard).toBeVisible()

    // Navigate to Events and verify event count (89 real events — no more injected liquidation)
    await navigateTo(page, 'Events')
    await expect(page.getByText('Events Timeline')).toBeVisible()
    await expect(page.getByRole('button', { name: /All types \(89\)/i })).toBeVisible()

    // Navigate to Prices and add a new price
    await navigateTo(page, 'Prices')
    await expect(page.getByText('8 price entries')).toBeVisible()

    await page.getByRole('button', { name: '+ Price' }).click()
    await expect(page.getByText('Add Price')).toBeVisible()

    await page.getByLabel('Effective Date').fill('2026-03-01')
    await page.getByLabel('Price per Share').fill('25.00')
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    // Back to list with 9 prices
    await expect(page.getByText('9 price entries')).toBeVisible()

    // Events should now have one more (Share Price event): 89 + 1 = 90
    await navigateTo(page, 'Events')
    await expect(page.getByRole('button', { name: /All types \(90\)/i })).toBeVisible()

    // Export should work
    await navigateTo(page, 'Import')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export to Excel' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('Vesting.xlsx')
  })
})

import { test, expect } from '@playwright/test'
import { getTestToken, loginAs, navigateTo } from './helpers'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test.describe('Full user journey', () => {
  let token: string

  test.beforeEach(async ({ page, request }) => {
    token = await getTestToken(request, 'journey@test.com', 'Journey User')
    await loginAs(page, token)
  })

  test('import xlsx → dashboard → events → add price → export', async ({ page }) => {
    // Verify dashboard loads (empty state)
    await expect(page.getByText('Share Price')).toBeVisible()

    // Navigate to Import page
    await navigateTo(page, 'Import')
    await expect(page.getByText('Import from Excel')).toBeVisible()

    // Upload fixture.xlsx
    const fixtureFile = path.resolve(__dirname, '../../test_data/fixture.xlsx')
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(fixtureFile)

    // Confirm destructive import
    await expect(page.getByText('This will replace all your existing')).toBeVisible()
    await page.getByRole('button', { name: 'Replace All Data' }).click()

    // Wait for success message
    await expect(page.getByText('Import complete')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('12 grants')).toBeVisible()
    await expect(page.getByText('21 loans')).toBeVisible()
    await expect(page.getByText('8 prices')).toBeVisible()

    // Navigate to Dashboard and verify data loaded
    await navigateTo(page, 'Dashboard')
    await page.waitForLoadState('networkidle')

    // Dashboard cards should show Total Shares > 0
    const sharesCard = page.locator('text=Total Shares').locator('..')
    await expect(sharesCard).toBeVisible()

    // Navigate to Events and verify event count (spec: 89 events)
    await navigateTo(page, 'Events')
    await expect(page.getByText('Events Timeline')).toBeVisible()
    const typeSelect = page.locator('select')
    await expect(typeSelect).toContainText('All types (89)')

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

    // Events should now have one more (Share Price event)
    await navigateTo(page, 'Events')
    const updatedSelect = page.locator('select')
    await expect(updatedSelect).toContainText('All types (90)')

    // Export should work
    await navigateTo(page, 'Import')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download Vesting.xlsx' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('Vesting.xlsx')
  })
})

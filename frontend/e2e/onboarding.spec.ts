import { test, expect } from '@playwright/test'
import { loginAs, resetUserData } from './helpers'

test.describe('Onboarding wizard', () => {
  test.beforeEach(async ({ page }) => {
    const email = `onboarding-${test.info().testId}@test.com`
    await loginAs(page, email, 'Onboarding User')
    await resetUserData(page)
    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test('new user sees wizard instead of empty state links', async ({ page }) => {
    await expect(page.getByText("Let's set up your equity tracker.")).toBeVisible()
    await expect(page.getByRole('button', { name: /Import Excel/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Enter manually/i })).toBeVisible()
  })

  test('Import Excel path navigates to /import', async ({ page }) => {
    await page.getByRole('button', { name: /Import Excel/i }).click()
    await expect(page).toHaveURL(/\/import/)
  })

  test('manual flow: add grant → add price → set tax → done → dashboard', async ({ page }) => {
    // Step 1: Welcome → choose manual
    await page.getByRole('button', { name: /Enter manually/i }).click()
    await expect(page.getByText('Add your first grant')).toBeVisible()
    await expect(page.getByText('Step 1 of 4')).toBeVisible()

    // Step 2: Fill grant form and save
    await page.getByLabel('Year').fill('2024')
    await page.getByLabel('Shares').fill('10000')
    await page.getByLabel('Cost Basis').fill('5.00')
    await page.getByLabel('Vest Start').fill('2025-03-01')
    await page.getByLabel('Vest Periods').fill('4')
    await page.getByLabel('Exercise Date').fill('2024-12-31')
    await page.getByRole('button', { name: /Next/i }).click()

    // Step 3: Add share price
    await expect(page.getByText('Add share prices')).toBeVisible()
    await expect(page.getByText('Step 2 of 4')).toBeVisible()
    await page.getByLabel('Effective Date').fill('2024-12-31')
    await page.getByLabel('Price per Share').fill('10.00')
    await page.getByRole('button', { name: /Next/i }).click()

    // Step 4: Tax rates
    await expect(page.getByText('Set tax rates')).toBeVisible()
    await expect(page.getByText('Step 3 of 4')).toBeVisible()
    await page.getByRole('button', { name: /Next/i }).click()

    // Step 5: Done
    await expect(page.getByText('Your dashboard is ready')).toBeVisible()
    await expect(page.getByText('Step 4 of 4')).toBeVisible()
    await expect(page.getByText(/Purchase grant/)).toBeVisible()

    // Click "View dashboard" → triggers reload, should show real dashboard
    await page.getByRole('button', { name: /View dashboard/i }).click()

    // After completing onboarding, the dashboard should render with data (events now exist)
    await expect(page.getByText('Events Timeline').or(page.getByText('Shares Over Time'))).toBeVisible({ timeout: 10000 })
  })

  test('manual flow: can skip price and tax steps', async ({ page }) => {
    await page.getByRole('button', { name: /Enter manually/i }).click()

    // Fill minimal grant data and save
    await page.getByLabel('Year').fill('2024')
    await page.getByLabel('Shares').fill('5000')
    await page.getByLabel('Cost Basis').fill('3.00')
    await page.getByLabel('Vest Start').fill('2025-01-01')
    await page.getByLabel('Vest Periods').fill('4')
    await page.getByLabel('Exercise Date').fill('2024-06-30')
    await page.getByRole('button', { name: /Next/i }).click()

    // Skip price
    await expect(page.getByText('Add share prices')).toBeVisible()
    await page.getByRole('button', { name: 'Skip' }).click()

    // Skip tax
    await expect(page.getByText('Set tax rates')).toBeVisible()
    await page.getByRole('button', { name: 'Skip' }).click()

    // Arrive at done
    await expect(page.getByText('Your dashboard is ready')).toBeVisible()
  })
})

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
    await expect(page.getByRole('button', { name: /Import from file/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Manual entry/i })).toBeVisible()
  })

  test('Import from file path shows upload screen', async ({ page }) => {
    await page.getByRole('button', { name: /Import from file/i }).click()
    await expect(page.getByText('Import from file')).toBeVisible()
  })

  test('manual flow: add grant → review → done → dashboard', async ({ page }) => {
    // Welcome → choose manual
    await page.getByRole('button', { name: /Manual entry/i }).click()
    await expect(page.getByText('Share price history')).toBeVisible()

    // Proceed past prices step without adding any
    await page.getByRole('button', { name: /Next: Add grants/i }).click()

    // Grant entry screen
    await expect(page.getByText('Add a grant')).toBeVisible()

    // Fill grant form
    await page.getByLabel('Grant year').fill('2024')
    await page.getByLabel('Shares', { exact: true }).fill('10000')
    await page.getByLabel('Cost basis ($/share)').fill('5.00')
    await page.getByLabel('Vest start').fill('2025-03-01')
    await page.getByLabel('Vesting periods').fill('4')
    await page.getByLabel('Exercise date').fill('2024-12-31')
    await page.getByRole('button', { name: /Next →/i }).click()

    // No purchase loan
    await expect(page.getByText('Did you take out a loan to purchase this grant?')).toBeVisible()
    await page.getByRole('button', { name: /^No$/i }).click()

    // More grants? → No, review & submit
    await expect(page.getByText('Add another grant?')).toBeVisible()
    await page.getByRole('button', { name: /No, review/i }).click()

    // Review screen → submit
    await expect(page.getByText('Review')).toBeVisible()
    await page.getByRole('button', { name: /Submit →/i }).click()

    // Done screen
    await expect(page.getByText('Setup complete!')).toBeVisible()

    // Click "View dashboard →"
    await page.getByRole('button', { name: /View dashboard/i }).click()

    // After completing, dashboard should render with data
    await expect(page.getByText('Events Timeline').or(page.getByText('Shares Over Time'))).toBeVisible({ timeout: 10000 })
  })

  test('manual flow: proceed from prices step', async ({ page }) => {
    await page.getByRole('button', { name: /Manual entry/i }).click()

    // Prices step has "Next: Add grants" button
    await expect(page.getByText('Share price history')).toBeVisible()
    await page.getByRole('button', { name: /Next: Add grants/i }).click()

    // Arrive at grant entry
    await expect(page.getByText('Add a grant')).toBeVisible()
  })
})

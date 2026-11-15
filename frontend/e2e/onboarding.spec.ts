import { test, expect } from '@playwright/test'
import { loginAs, navigateTo, resetUserData } from './helpers'

test.describe('Getting started', () => {
  test.beforeEach(async ({ page }) => {
    const email = `onboarding-${test.info().testId}@test.com`
    await loginAs(page, email, 'Onboarding User')
    await resetUserData(page)
    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test('an empty account offers every way in on one screen', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Get your stock in' })).toBeVisible()
    await expect(page.getByText('Import from Eureka')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Add a grant' })).toBeVisible()
  })

  test('add a grant, then move one vesting date for a leave', async ({ page }) => {
    await page.getByRole('link', { name: 'Add a grant' }).click()
    await page.getByRole('button', { name: '+ Bonus' }).click()
    await page.getByLabel('Year', { exact: true }).fill('2024')
    await page.getByLabel('Shares', { exact: true }).fill('1001')
    await page.getByLabel('Vest Start').fill('2025-03-01')
    await page.getByLabel('Vest Periods').fill('4')
    await page.getByLabel('Exercise Date').fill('2024-12-31')
    await page.getByRole('button', { name: /^Save$/ }).click()
    // Each part rounded down, the rest on the last date.
    await expect(page.getByText(/250 on 2025-03-01, 250 on 2026-03-01, 250 on 2027-03-01, 251 on 2028-03-01/).first()).toBeVisible()

    await page.getByRole('button', { name: 'Edit' }).first().click()
    await page.getByLabel('Vesting date 2', { exact: true }).fill('2026-09-15')
    await page.getByRole('button', { name: /^Save$/ }).click()
    await expect(page.getByText(/250 on 2026-09-15/).first()).toBeVisible()

    await navigateTo(page, 'Dashboard')
    await expect(page.getByText('Events Timeline').or(page.getByText('Shares Over Time'))).toBeVisible({ timeout: 10000 })
  })
})

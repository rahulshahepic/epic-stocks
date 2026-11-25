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

  test('an empty account leads with Eureka and expands alternative routes', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Get your stock in' })).toBeVisible()
    await expect(page.getByText('Import from Eureka')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Add a grant' })).toBeHidden()
    await page.getByText('Other ways to start', {exact: true}).click()
    await expect(page.getByRole('link', { name: 'Add a grant' })).toBeVisible()
  })

  test('add a grant, then move one vesting date for a leave', async ({ page }) => {
    await page.getByText('Other ways to start', {exact: true}).click()
    await page.getByRole('link', { name: 'Add a grant' }).click()
    await page.getByRole('button', { name: '+ Bonus' }).click()
    await page.getByLabel('Year', { exact: true }).fill('2024')
    await page.getByLabel('Shares', { exact: true }).fill('1001')
    await page.getByLabel('Vest Start').fill('2025-03-01')
    await page.getByLabel('Vest Periods').fill('4')
    await page.getByLabel('Exercise Date').fill('2024-12-31')
    await page.getByRole('button', { name: /^Save$/ }).click()
    // Each part rounded down, the rest on the last date.
    await expect(page.getByText(/250 on Mar 1, 2025, 250 on Mar 1, 2026, 250 on Mar 1, 2027, 251 on Mar 1, 2028/).first()).toBeVisible()

    await page.getByRole('button', { name: 'Edit' }).first().click()
    await page.getByLabel('Vesting date 2', { exact: true }).fill('2026-09-15')
    await page.getByRole('button', { name: /^Save$/ }).click()
    await expect(page.getByText(/250 on Sep 15, 2026/).first()).toBeVisible()

    await navigateTo(page, 'Dashboard')
    await expect(page.getByText('Events Timeline').or(page.getByText('Shares Over Time'))).toBeVisible({ timeout: 10000 })
  })
})

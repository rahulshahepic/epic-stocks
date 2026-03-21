import { test, expect } from '@playwright/test'
import { getTestToken, loginAs, navigateTo } from './helpers'

test.describe('Quick flow: purchase grant + loan', () => {
  let token: string

  test.beforeEach(async ({ page, request }) => {
    token = await getTestToken(request, `quickflow-${test.info().testId}@test.com`, 'QuickFlow User')
    await loginAs(page, token)
  })

  test('add purchase grant with loan → verify tables → verify events', async ({ page }) => {
    // First add a price (required to generate meaningful events)
    await navigateTo(page, 'Prices')
    await page.getByRole('button', { name: '+ Price' }).click()
    await page.getByLabel('Effective Date').fill('2024-12-31')
    await page.getByLabel('Price per Share').fill('10.00')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('1 price entries')).toBeVisible({ timeout: 10000 })

    // Navigate to Grants
    await navigateTo(page, 'Grants')
    await expect(page.getByText('No grants yet')).toBeVisible()

    // Open New Purchase form
    await page.getByRole('button', { name: '+ Purchase' }).click()
    await expect(page.getByText('New Purchase Grant')).toBeVisible()

    // Fill grant fields
    await page.getByLabel('Year').fill('2024')
    await page.getByLabel('Shares', { exact: true }).fill('10000')
    await page.getByLabel('Cost Basis').fill('10.00')
    await page.getByLabel('Vest Start').fill('2025-03-01')
    await page.getByLabel('Vest Periods').fill('4')
    await page.getByLabel('Exercise Date').fill('2024-12-31')

    // Fill optional loan fields
    await page.getByLabel('Loan Amount').fill('50000')
    await page.getByLabel('Interest Rate').fill('3.5')
    await page.getByLabel('Due Date').fill('2029-12-31')
    await page.getByLabel('Loan Number').fill('123456')

    // Save
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    // Verify grant appears in table
    await expect(page.getByText('1 grants')).toBeVisible({ timeout: 10000 })

    // Verify loan appears in Loans table
    await navigateTo(page, 'Loans')
    await expect(page.getByText('1 loans')).toBeVisible()
    await expect(page.getByText('123456')).toBeVisible()

    // Verify events are generated
    await navigateTo(page, 'Events')
    await expect(page.getByText('Events Timeline')).toBeVisible()

    // Should have events: 1 Exercise + 4 Vesting + 1 Loan Repayment = 6 events
    const typeSelect = page.locator('select')
    await expect(typeSelect).toContainText('All types (6)')

    // Filter to Exercise
    await typeSelect.selectOption('Exercise')
    await expect(page.getByText('1 events')).toBeVisible()

    // Filter to Vesting
    await typeSelect.selectOption('Vesting')
    await expect(page.getByText('4 events')).toBeVisible()

    // Filter to Loan Repayment
    await typeSelect.selectOption('Loan Repayment')
    await expect(page.getByText('1 events')).toBeVisible()
  })

  test('add bonus grant via quick flow', async ({ page }) => {
    // Add a price first
    await navigateTo(page, 'Prices')
    await page.getByRole('button', { name: '+ Price' }).click()
    await page.getByLabel('Effective Date').fill('2024-12-31')
    await page.getByLabel('Price per Share').fill('10.00')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('1 price entries')).toBeVisible({ timeout: 10000 })

    // Navigate to Grants and add a Bonus
    await navigateTo(page, 'Grants')
    await page.getByRole('button', { name: '+ Bonus' }).click()
    await expect(page.getByText('New Bonus Grant')).toBeVisible()

    await page.getByLabel('Year').fill('2024')
    await page.getByLabel('Shares', { exact: true }).fill('5000')
    await page.getByLabel('Vest Start').fill('2025-03-01')
    await page.getByLabel('Vest Periods').fill('2')
    await page.getByLabel('Exercise Date').fill('2024-12-31')

    await page.getByRole('button', { name: 'Save', exact: true }).click()

    // Verify grant appears
    await expect(page.getByText('1 grants')).toBeVisible({ timeout: 10000 })

    // Verify events: 1 Exercise + 2 Vesting = 3
    await navigateTo(page, 'Events')
    const typeSelect = page.locator('select')
    await expect(typeSelect).toContainText('All types (3)')
  })
})

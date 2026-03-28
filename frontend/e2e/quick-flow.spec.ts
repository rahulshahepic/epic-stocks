import { test, expect } from '@playwright/test'
import { getTestToken, loginAs, navigateTo, resetUserData } from './helpers'

test.describe('Quick flow: purchase grant + loan', () => {
  let token: string

  test.beforeEach(async ({ page, request }) => {
    const email = `quickflow-${test.info().testId}@test.com`
    token = await getTestToken(request, email, 'QuickFlow User')
    await resetUserData(request, token)
    await loginAs(page, email, 'QuickFlow User')
  })

  test('add purchase grant with loan → verify tables → verify events', async ({ page }) => {
    // First add a price (required to generate meaningful events)
    await navigateTo(page, 'Prices')
    await page.getByRole('button', { name: '+ Price' }).click()
    await page.getByLabel('Effective Date').fill('2024-12-31')
    await page.getByLabel('Price per Share').fill('10.00')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForLoadState('networkidle')
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

    // Verify loan appears in Loans table; loan # is in the drill-in card
    await navigateTo(page, 'Loans')
    await expect(page.getByText('1 loans')).toBeVisible()
    // auto-payoff sale was created (price exists) → expand via ✓ linked badge
    await page.getByText('\u2713 linked').click()
    await expect(page.getByText('123456')).toBeVisible()

    // Verify events are generated
    await navigateTo(page, 'Events')
    await expect(page.getByText('Events Timeline')).toBeVisible()

    // Should have events: 1 Exercise + 4 Vesting + 1 Loan Payoff + 1 Sale + 1 Liquidation (projected) = 8 events
    const filterBtn = page.getByRole('button', { name: /All types/i })
    await expect(filterBtn).toContainText('All types (8)')

    // Filter to Exercise
    await filterBtn.click()
    await page.getByRole('checkbox', { name: /^Exercise/ }).click()
    await expect(page.getByText('1 events')).toBeVisible()

    // Filter to Vesting (clear Exercise first, then select Vesting)
    await page.getByRole('checkbox', { name: /^Exercise/ }).click()
    await page.getByRole('checkbox', { name: /^Vesting/ }).click()
    await expect(page.getByText('4 events')).toBeVisible()

    // Filter to Loan Payoff
    await page.getByRole('checkbox', { name: /^Vesting/ }).click()
    await page.getByRole('checkbox', { name: /^Loan Payoff/ }).click()
    await expect(page.getByText('1 events')).toBeVisible()
  })

  test('add bonus grant via quick flow', async ({ page }) => {
    // Add a price first
    await navigateTo(page, 'Prices')
    await page.getByRole('button', { name: '+ Price' }).click()
    await page.getByLabel('Effective Date').fill('2024-12-31')
    await page.getByLabel('Price per Share').fill('10.00')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForLoadState('networkidle')
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

    // Verify events: 1 Exercise + 2 Vesting + 1 Liquidation (projected) = 4
    await navigateTo(page, 'Events')
    await expect(page.getByRole('button', { name: /All types \(4\)/i })).toBeVisible()
  })
})

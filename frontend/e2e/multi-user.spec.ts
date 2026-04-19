import { test, expect } from '@playwright/test'
import { loginAs, navigateTo, resetUserData } from './helpers'

test.describe('Multi-user isolation', () => {
  test('two users cannot see each other\'s data', async ({ page }) => {
    // Reset both users before starting (loginAs sets the cookie, then resetUserData uses it)
    await loginAs(page, 'usera-isolation@test.com', 'User A')
    await resetUserData(page)
    await loginAs(page, 'userb-isolation@test.com', 'User B')
    await resetUserData(page)

    // Start as User A
    await loginAs(page, 'usera-isolation@test.com', 'User A')

    // Add a price as User A
    await navigateTo(page, 'Prices')
    await page.getByRole('button', { name: '+ Price' }).click()
    await page.getByLabel('Effective Date').fill('2028-03-01')
    await page.getByLabel('Price per Share').fill('10.00')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('1 price entry')).toBeVisible({ timeout: 10000 })

    // Add a grant as User A
    await navigateTo(page, 'Grants')
    await page.getByRole('button', { name: '+ Purchase' }).click()
    await page.getByLabel('Year').fill('2024')
    await page.getByLabel('Shares', { exact: true }).fill('10000')
    await page.getByLabel('Price per share at grant', { exact: true }).fill('10.00')
    await page.getByLabel('Vest Start').fill('2025-03-01')
    await page.getByLabel('Vest Periods').fill('4')
    await page.getByLabel('Exercise Date').fill('2024-12-31')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('1 grants')).toBeVisible({ timeout: 10000 })

    // Verify User A sees events
    await navigateTo(page, 'Events')
    await expect(page.getByRole('button', { name: /All types/i })).not.toContainText('All types (0)')

    // Switch to User B
    await loginAs(page, 'userb-isolation@test.com', 'User B')

    // User B should see empty data
    await navigateTo(page, 'Grants')
    await expect(page.getByText('No grants yet')).toBeVisible({ timeout: 10000 })

    await navigateTo(page, 'Prices')
    await expect(page.getByText('No prices yet')).toBeVisible({ timeout: 10000 })

    await navigateTo(page, 'Loans')
    await expect(page.getByText('No loans yet')).toBeVisible({ timeout: 10000 })

    // User B adds their own price
    await navigateTo(page, 'Prices')
    await page.getByRole('button', { name: '+ Price' }).click()
    await page.getByLabel('Effective Date').fill('2028-06-01')
    await page.getByLabel('Price per Share').fill('20.00')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('1 price entry')).toBeVisible({ timeout: 10000 })

    // Switch back to User A — data should be unchanged
    await loginAs(page, 'usera-isolation@test.com', 'User A')
    await navigateTo(page, 'Prices')
    await expect(page.getByText('1 price entry')).toBeVisible({ timeout: 10000 })

    // User A's price should be $10.00, not $20.00
    await expect(page.getByText('$10.00')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('$20.00')).not.toBeVisible()

    // User A should still see their grant
    await navigateTo(page, 'Grants')
    await expect(page.getByText('1 grants')).toBeVisible({ timeout: 10000 })
  })
})

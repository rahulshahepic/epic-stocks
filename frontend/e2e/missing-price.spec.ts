import { test, expect } from '@playwright/test'
import { loginAs, resetUserData } from './helpers'

for (const theme of ['light', 'dark'] as const) {
  test(`missing share price preserves retirement inputs - ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme })
    await loginAs(page, `missing-price-${theme}@e2e.test`)
    await resetUserData(page)
    const grant = await page.request.post('/api/grants', {data: {
      year: 2025, type: 'Purchase', shares: 100, price: 0,
      vest_start: '2025-03-01', periods: 5, exercise_date: '2025-01-01',
      dp_shares: 0, election_83b: true,
    }})
    expect(grant.ok(), await grant.text()).toBeTruthy()
    await page.goto('/')
    await expect(page.getByText(/Price not entered for this date/)).toBeVisible()
    await expect(page.getByRole('link', {name: 'Add a price', exact: true})).toHaveAttribute('href', '/prices')
    await expect(page.getByText(/Price not entered · 1 tranche/).first()).toBeVisible()
    await expect(page.getByText(/\$0 market value/)).toHaveCount(0)
    if (process.env.SCREENSHOT_EMAIL) await page.screenshot({path: `../screenshots/missing-price-dashboard-${theme}-mobile.png`, fullPage: true})

    await page.goto('/retirement')
    await expect(page.getByText(/Add a share price to project your exit/)).toBeVisible()
    await page.getByLabel(/^Default spend/).fill('80000')
    await expect.poll(async () => (await (await page.request.get('/api/retirement/params')).json()).params?.defaultSpend).toBe(80)
    await page.reload()
    await expect(page.getByLabel(/^Default spend/)).toHaveValue('80000')
    await expect(page.getByText(/Add a share price to project your exit/)).toBeVisible()
    if (process.env.SCREENSHOT_EMAIL) {
      await page.getByText(/Add a share price to project your exit/).scrollIntoViewIfNeeded()
      await page.screenshot({path: `../screenshots/missing-price-retirement-${theme}-mobile.png`})
    }
    await page.getByRole('link', {name: 'Add a price', exact: true}).click()
    await expect(page).toHaveURL(/\/prices$/)
    const price = await page.request.post('/api/prices', {data: {effective_date: '2025-01-01', price: 100, is_estimate: false}})
    expect(price.ok(), await price.text()).toBeTruthy()
    await page.goto('/retirement')
    await expect(page.getByLabel(/^Epic exit value/)).not.toHaveValue('0')
    await expect(page.getByText(/Add a share price to project your exit/)).toHaveCount(0)
    await expect(page.getByLabel(/^Default spend/)).toHaveValue('80000')
  })
}

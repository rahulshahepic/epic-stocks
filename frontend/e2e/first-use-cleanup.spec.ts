import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import * as path from 'node:path'

for (const theme of ['light', 'dark'] as const) for (const device of ['mobile', 'desktop'] as const) {
  test(`first use clarity ${theme} ${device}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    await page.setViewportSize(device === 'mobile' ? { width: 375, height: 812 } : { width: 1280, height: 900 })
    await page.goto('/try')
    await page.locator('#trial-csv').setInputFiles(path.resolve('../test_data/epic_share_summary.csv'))
    await page.getByRole('button', { name: 'See my numbers' }).click()
    const hero = page.getByText(/Stock value \(loans not included\) · as of/).locator('..')
    await expect(hero).toContainText('Loans: not uploaded')
    await expect(hero).toContainText('cannot subtract shares you have sold')
    await expect(page.getByText('Not uploaded', { exact: true })).toBeVisible()
    await expect(page.getByText(/No files handy/)).toHaveCount(0)
    await expect(page.getByText(/Net worth · as of/)).toHaveCount(0)
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: `../screenshots/first-use-trial-${theme}-${device}.png`, fullPage: true, style: '[aria-label="Mobile navigation"]{visibility:hidden!important}' })

    const login = await page.request.post('/api/auth/test-login', { data: { email: `first-use-${theme}-${device}@e2e.test`, name: 'Fictional first-time user' } })
    expect(login.ok()).toBe(true)
    expect((await page.request.post('/api/me/reset')).ok()).toBe(true)
    await page.goto('/')
    await expect(page.getByText('Import from Eureka')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Add a grant' })).toBeHidden()
    await page.screenshot({ path: `../screenshots/first-use-empty-${theme}-${device}.png`, fullPage: true, style: '[aria-label="Mobile navigation"]{visibility:hidden!important}' })
    await page.getByText('Other ways to start', { exact: true }).click()
    await expect(page.getByRole('link', { name: 'Add a grant' })).toBeVisible()

    const today = new Date().toISOString().slice(0, 10)
    const year = Number(today.slice(0, 4))
    expect((await page.request.post('/api/grants', { data: { year, type: 'Purchase', shares: 100, price: 0,
      exercise_date: today, vest_start: today, periods: 1, dp_shares: 0, election_83b: true } })).ok()).toBe(true)
    await page.reload()
    await expect(page.getByRole('link', { name: 'Add a price' })).toBeVisible()
    await expect(page.getByText('100 shares', { exact: true })).toBeVisible()
    await expect(page.getByText(/Interest: Calculated estimate/)).toHaveCount(0)
    await expect(page.getByText(/Exit estimate unavailable/)).toHaveCount(0)
    await expect(page.getByText('If you exited on this date')).toHaveCount(0)
    await expect(page.getByText('Value Today', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Unvested Shares', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Next Event', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Earnings and borrowing costs', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Income vs capital gains', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Estimated Tax Liability', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/Your \d{4} stock summary/)).toHaveCount(0)
    await expect(page.getByText('Ad astra per aspera', { exact: true }).last()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const audit = await new AxeBuilder({ page }).include('.campus-dashboard').withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(audit.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
    await page.screenshot({ path: `../screenshots/first-use-sparse-${theme}-${device}.png`, fullPage: true, style: '[aria-label="Mobile navigation"]{visibility:hidden!important}' })
  })
}

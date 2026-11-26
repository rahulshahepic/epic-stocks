import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs } from './helpers.ts'

for (const theme of ['light', 'dark'] as const) for (const device of ['mobile', 'desktop'] as const) {
  test(`empty stock plan and summary eligibility ${theme} ${device}`, async ({page}) => {
    await page.emulateMedia({colorScheme: theme})
    await loginAs(page, `hygiene-${theme}-${device}@example.test`)
    await page.setViewportSize(device === 'mobile' ? {width: 375, height: 812} : {width: 1280, height: 900})
    await page.goto('/retirement')
    await expect(page.getByText(/No stock imported yet/)).toBeVisible()
    await page.getByLabel(/^Date of birth/).fill('1985-01-01')
    await page.getByLabel(/^Default spend/).fill('77000')
    await expect(page.getByText('All inputs saved', {exact: true})).toBeVisible()
    await expect.poll(async () => (await (await page.request.get('/api/me')).json()).date_of_birth).toBe('1985-01-01')
    await page.reload()
    await expect(page.getByText(/No stock imported yet/)).toBeVisible()
    await expect(page.getByLabel(/^Default spend/)).toHaveValue('77000')
    await expect(page.getByLabel(/^Date of birth/)).toHaveValue('1985-01-01')
    expect((await new AxeBuilder({page}).analyze()).violations.filter(v => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.addStyleTag({content: '[aria-label="Mobile navigation"]{visibility:hidden!important}'})
    await page.screenshot({path: `../screenshots/retirement-empty-${theme}-${device}.png`, fullPage: true})
    // Expose a configured email provider while retaining the account's real,
    // default-off preference. Availability must not imply an enabled channel.
    await page.route('**/api/config', async route => {
      const response = await route.fetch()
      await route.fulfill({response, json: {...await response.json(), email_notifications_available: true, vapid_public_key: ''}})
    })
    await page.goto('/settings#notifications')
    await page.reload()
    await expect(page.getByText(/Turn on email or push notifications to receive/)).toBeVisible()
    await expect(page.getByRole('checkbox', {name: /Include an annual stock summary/})).toBeDisabled()
    await page.getByRole('heading', {name: 'Notifications', exact: true}).locator('..').screenshot({path: `../screenshots/summary-no-channel-${theme}-${device}.png`})
  })
}

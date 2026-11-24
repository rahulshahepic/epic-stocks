import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

for (const theme of ['light', 'dark'] as const) {
  for (const device of ['mobile', 'desktop'] as const) {
    test(`anonymous demo ${theme} ${device}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.setViewportSize(
        device === 'mobile'
          ? { width: 375, height: 812 }
          : { width: 1280, height: 900 }
      )
      const mutations: string[] = []
      page.on('request', (r) => {
        if (
          r.method() !== 'GET' &&
          r.url().includes('/api/') &&
          !r.url().includes('/api/demo/')
        )
          mutations.push(r.url())
      })
      await page.goto('/login')
      expect((await new AxeBuilder({page}).analyze()).violations.filter(v => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
      await page
        .getByRole('link', { name: /Explore a fictional employee demo/ })
        .click()
      await expect(
        page.getByText('Estimated cash if leaving', { exact: false })
      ).toBeVisible()
      await expect(page.getByText('Loading fictional profile…')).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: /Established/ })
      ).toHaveAttribute('aria-pressed', 'true')
      const overflow = () =>
        page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth
        )
      expect(await overflow()).toBe(false)
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      await page.screenshot({
        path: `../screenshots/demo-overview-${theme}-${device}.png`,
        fullPage: true
      })
      await page.getByRole('button', { name: 'Sale what-if' }).click()
      await page.getByLabel('Shares to sell').fill('100')
      await page.getByRole('button', { name: 'Estimate sale' }).click()
      await expect(page.getByLabel('Sale estimate')).toBeVisible()
      await page.screenshot({
        path: `../screenshots/demo-sale-${theme}-${device}.png`,
        fullPage: true
      })
      await page.getByRole('button', { name: 'Events', exact: true }).click()
      await expect(
        page.getByRole('heading', { name: 'Fictional stock timeline' })
      ).toBeVisible()
      expect(await overflow()).toBe(false)
      await page.getByRole('button', { name: /Planning an exit/ }).click()
      await expect(page.getByText('Loading fictional profile…')).toHaveCount(0)
      await page
        .getByRole('button', { name: 'Retirement', exact: true })
        .click()
      await page.getByRole('button', { name: 'Run simulation' }).click()
      await expect(page.getByLabel('Retirement results')).toBeVisible({
        timeout: 25000
      })
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      expect(await overflow()).toBe(false)
      await page.screenshot({
        path: `../screenshots/demo-retirement-${theme}-${device}.png`,
        fullPage: true
      })
      await page.getByRole('button', { name: 'Reset demo' }).click()
      await expect(
        page.getByRole('button', { name: /Established/ })
      ).toHaveAttribute('aria-pressed', 'true')
      await expect(
        page.getByText('Estimated cash if leaving', { exact: false })
      ).toBeVisible()
      await page.getByRole('button', { name: /Early career/ }).click()
      await expect(page.getByText('Loading fictional profile…')).toHaveCount(0)
      await expect(
        page.getByText('Estimated cash if leaving', { exact: false })
      ).toBeVisible()
      const storageBefore = await page.evaluate(() => ({
        session: Object.keys(sessionStorage),
        local: Object.keys(localStorage)
      }))
      expect(storageBefore.session.some((k) => /trial|draft/i.test(k))).toBe(
        false
      )
      expect(mutations).toEqual([])
      await page.getByRole('link', { name: /Use my own files/ }).click()
      await expect(page).toHaveURL(/\/try$/)
    })
  }
}

test('demo recovers from busy response', async ({ page }) => {
  await page.route('**/api/demo/preview', (route) =>
    route.fulfill({
      status: 503,
      json: { detail: 'Demo calculations are busy; please retry shortly' }
    })
  )
  await page.goto('/demo')
  await expect(page.getByRole('alert')).toContainText('busy')
  await page.unroute('**/api/demo/preview')
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(
    page.getByText('Estimated cash if leaving', { exact: false })
  ).toBeVisible()
})


test('early career can quote every vested share', async ({ page }) => {
  await page.goto('/demo')
  await expect(page.getByText('Loading fictional profile…')).toHaveCount(0)
  await page.getByRole('button', { name: /Early career/ }).click()
  await expect(page.getByText('Loading fictional profile…')).toHaveCount(0)
  const response = await page.request.post('/api/demo/preview', { data: { profile: 'early' } })
  const data = await response.json()
  const vested = data.dashboard.held_vested_shares
  expect(vested).toBeGreaterThan(0)
  expect(vested).toBeLessThan(data.dashboard.cards.unvested_shares)
  await page.getByRole('button', { name: 'Sale what-if' }).click()
  await expect(page.getByLabel('Shares to sell')).toHaveAttribute('max', String(vested))
  await page.getByLabel('Shares to sell').fill(String(vested))
  await page.getByRole('button', { name: 'Estimate sale' }).click()
  await expect(page.getByLabel('Sale estimate')).toBeVisible()
})

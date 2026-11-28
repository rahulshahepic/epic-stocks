import { expect, test, type Locator } from '@playwright/test'
import { loginAs, resetUserData } from './helpers'

async function expectFigureToFit(figure: Locator) {
  await expect(figure).toBeVisible()
  const { lines, left, right, availableLeft, availableRight } = await figure.evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const text = range.getBoundingClientRect()
    const available = element.closest('p')!.getBoundingClientRect()
    return {
      lines: range.getClientRects().length,
      left: text.left,
      right: text.right,
      availableLeft: available.left,
      availableRight: available.right,
    }
  })
  expect(lines).toBe(1)
  expect(left).toBeGreaterThanOrEqual(availableLeft)
  expect(right).toBeLessThanOrEqual(availableRight)
}

test('dashboard keeps full ten-digit figures on one line', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await loginAs(page, `large-figures-${test.info().testId}@test.com`)
  await resetUserData(page)
  const grant = await page.request.post('/api/grants', { data: {
    year: 2020, type: 'Purchase', shares: 10000, price: 10, exercise_date: '2020-01-01',
    vest_start: '2021-01-01', periods: 4, dp_shares: 0, election_83b: true,
  } })
  expect(grant.ok(), await grant.text()).toBe(true)
  const price = await page.request.post('/api/prices', { data: { effective_date: '2020-01-01', price: 20 } })
  expect(price.ok(), await price.text()).toBe(true)

  await page.route(/\/api\/dashboard\?as_of=/, async route => {
    const response = await route.fetch()
    const snapshot = await response.json()
    Object.assign(snapshot.cards, {
      total_stock_value: 9876543210,
      total_cost_basis: 2345678901,
      vested_stock_value: 9876543210,
      total_cap_gains: -1234567890,
      total_loan_principal: 1234567890,
    })
    await route.fulfill({ response, json: snapshot })
  })
  await page.route(/\/api\/preview-exit\?date=/, async route => {
    const response = await route.fetch()
    const preview = await response.json()
    Object.assign(preview, {
      liquidation_net_cash: 8765432109,
      net_cash: 7654321098,
      gross_vested: 9876543210,
    })
    await route.fulfill({ response, json: preview })
  })
  await page.route('**/api/dashboard/charts', async route => {
    const response = await route.fetch()
    const charts = await response.json()
    charts.charts.tax = [
      { date: '2020-01-01', estimated: 0, paid: 0, projected: false },
      { date: '2024-01-01', estimated: 4000000000, paid: 0, projected: false },
    ]
    await route.fulfill({ response, json: charts })
  })
  await page.reload()
  const hero = page.getByRole('region', { name: 'Your stock at a glance' })
  await expect(hero.getByText('$8,765,432,109', { exact: true })).toBeVisible()
  const position = page.getByRole('region', { name: 'Your position' })
  await position.locator('summary').filter({ hasText: /^Earnings and borrowing costs$/ }).press('Enter')
  const exits = page.getByRole('region', { name: 'If you leave' })
  await exits.locator('summary').filter({ hasText: /^Exit breakdown and earlier cash$/ }).press('Enter')
  const trends = page.getByRole('region', { name: 'Stock over time' })
  await trends.locator('summary').filter({ hasText: /^More charts/ }).press('Enter')
  const taxChart = trends.locator('.recharts-wrapper').filter({ hasText: 'Est. Tax' })
  const taxTick = taxChart.getByText('4000000000', { exact: true })
  await expect(taxTick).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  for (const width of [320, 360, 375, 390, 640, 768, 1280]) {
    await test.step(`figures fit at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 812 })
      await expectFigureToFit(hero.getByText('$9,876,543,210', { exact: true }))
      await expectFigureToFit(hero.getByText('$8,765,432,109', { exact: true }))
      await expectFigureToFit(position.getByText('$2,345,678,901', { exact: true }))
      await expectFigureToFit(position.getByText('$9,876,543,210', { exact: true }))
      await expectFigureToFit(position.getByText('-$1,234,567,890', { exact: true }))
      await expectFigureToFit(position.getByText('$1,234,567,890', { exact: true }))
      await expectFigureToFit(exits.getByText('$7,654,321,098', { exact: true }))
      await expectFigureToFit(exits.getByText('$9,876,543,210', { exact: true }))
      await expect.poll(async () => (await taxTick.boundingBox())!.x).toBeGreaterThanOrEqual((await taxChart.boundingBox())!.x)
    })
  }
})

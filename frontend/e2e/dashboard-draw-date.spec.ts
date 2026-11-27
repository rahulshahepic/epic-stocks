import {test, expect} from '@playwright/test'
import {loginAs, resetUserData} from './helpers'

test('dashboard excludes a same-year future draw and loads tips with multiple loans', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-11-15T12:00:00'))
  await loginAs(page, `draw-date-${test.info().testId}@test.com`)
  await resetUserData(page)
  const post = async (path: string, data: object) => {
    const response = await page.request.post(`/api/${path}`, {data})
    expect(response.ok(), await response.text()).toBeTruthy()
  }
  await post('grants', {
    year: 2026, type: 'Purchase', shares: 10000, price: 10,
    exercise_date: '2026-01-01', vest_start: '2027-01-01', periods: 4,
    dp_shares: 0, election_83b: true,
  })
  await post('prices', {effective_date: '2026-01-01', price: 10})
  for (const [amount, disbursed_on] of [[10000, '2026-01-01'], [20000, '2026-11-30']] as const) {
    await post('loans?generate_payoff_sale=false', {
      grant_year: 2026, grant_type: 'Purchase', loan_type: 'Purchase',
      loan_year: 2026, amount, disbursed_on, interest_rate: 0.05, due_date: '2035-06-30',
    })
  }
  const tipsResponse = page.waitForResponse(r => r.url().endsWith('/api/tips'))
  await page.reload()
  expect((await tipsResponse).status()).toBe(200)
  const hero = page.getByRole('region', {name: 'Your stock at a glance'})
  await expect(hero).toContainText('Stock value before loans and taxes')
  await expect(hero).toContainText('$100,000')
  const calculations = hero.locator('details')
  await expect(calculations).toContainText('$10,000')
  await expect(calculations).not.toContainText('$30,000')
  await page.locator('input[type="date"]').first().fill('2026-11-30')
  await expect(calculations).toContainText('$30,000')
  await expect(page.getByText(/not supported between instances/)).toBeHidden()
})

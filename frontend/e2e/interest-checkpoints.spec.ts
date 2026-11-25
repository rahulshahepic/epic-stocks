import {test, expect} from '@playwright/test'
import {loginAs, resetUserData} from './helpers'

test('statement cutoff anchors interest without rewriting earlier dates', async ({page}) => {
  await loginAs(page, `interest-${test.info().testId}@test.com`)
  await resetUserData(page)
  const post = async (path: string, data: object) => {
    const response = await page.request.post(`/api/${path}`, {data})
    expect(response.ok(), await response.text()).toBeTruthy()
    return response.json()
  }
  await post('grants', {year: 2025, type: 'Purchase', shares: 1000, price: 10,
    exercise_date: '2025-01-01', vest_start: '2026-09-30', periods: 4})
  await post('prices', {effective_date: '2025-01-01', price: 12})
  const loan = await post('loans?generate_payoff_sale=false', {
    grant_year: 2025, grant_type: 'Purchase', loan_type: 'Purchase', loan_year: 2025,
    amount: 10000, interest_rate: .0365, due_date: '2028-12-31', disbursed_on: '2025-01-01',
  })
  await post('loan-interest-checkpoints', {loan_id: loan.id, statement_date: '2025-11-01',
    accrued_through: '2025-11-01', accrued_interest: 350, source: 'Monthly statement'})
  await page.reload()
  await page.locator('input[type="date"]').first().fill('2025-11-15')
  await expect(page.getByText('Interest: Reconciled through 2025-11-01; estimated afterward')).toBeVisible()
  const accruedInterest = page.locator('.campus-hero').getByText('Accrued interest', {exact: true}).locator('..')
  await expect(accruedInterest).toContainText('$364')
  await page.locator('input[type="date"]').first().fill('2025-10-01')
  await expect(page.getByText('Interest: Calculated estimate')).toBeVisible()
  await expect(accruedInterest).toContainText('$273')
})

import { test, expect } from '@playwright/test'

test('directory reviewer: production-shaped login, persistent financial writes, isolated accounts', async ({ page, browser }) => {
  await page.request.post('/api/auth/test-login', { data: { email: 'admin@e2e.test', name: 'Test administrator' } })
  const accounts = []
  for (const platform of ['openai', 'anthropic']) {
    const response = await page.request.post('/api/admin/reviewers/access', { data: { platform, scenario: 'established', days: 30 } })
    expect(response.ok()).toBeTruthy()
    accounts.push(await response.json())
  }
  expect(accounts[0].login).not.toBe(accounts[1].login)
  const reviewerContext = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173' })
  const reviewer = await reviewerContext.newPage()
  await reviewer.goto('/reviewer-login')
  await reviewer.getByLabel('Reviewer login').fill(accounts[0].login)
  await reviewer.getByLabel('Password', { exact: true }).fill(accounts[0].password)
  await reviewer.getByRole('button', { name: 'Sign in to fictional account' }).click()
  await expect(reviewer).toHaveURL(/\/$/)
  const grants = await reviewer.request.get('/api/grants')
  expect(grants.ok()).toBeTruthy()
  expect((await grants.json()).length).toBeGreaterThan(0)
  const saved = await reviewer.request.post('/api/prices', { data: { effective_date: '2043-01-01', price: 1000, is_estimate: true } })
  expect(saved.status()).toBe(201)
  expect((await (await reviewer.request.get('/api/prices')).json()).some((p: { effective_date: string }) => p.effective_date === '2043-01-01')).toBeTruthy()
  expect((await reviewer.request.get('/api/admin/reviewers')).status()).toBe(403)
  expect((await reviewer.request.get('/api/sharing')).status()).toBe(403)
  for (const account of accounts) {
    const preview = await (await page.request.post(`/api/admin/reviewers/${account.id}/manage`, { data: { action: 'delete' } })).json()
    expect((await page.request.post(`/api/admin/reviewers/${account.id}/manage`, { data: { action: 'delete', confirm: preview.confirm } })).ok()).toBeTruthy()
  }
  expect((await reviewer.request.get('/api/grants')).status()).toBe(401)
  await reviewerContext.close()
})

import { type Page, type APIRequestContext, expect } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
const API_BASE = process.env.E2E_API_URL ?? BASE_URL

/** Register a test user via the E2E test-login endpoint, returns JWT token */
export async function getTestToken(request: APIRequestContext, email: string, name = 'Test User'): Promise<string> {
  const resp = await request.post(`${API_BASE}/api/auth/test-login`, {
    data: { email, name },
  })
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  return body.access_token
}

/** Set auth token in localStorage and navigate to the app */
export async function loginAs(page: Page, token: string) {
  await page.goto('/')
  await page.evaluate((t: string) => localStorage.setItem('auth_token', t), token)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
}

/** Navigate to a page via the nav bar */
export async function navigateTo(page: Page, label: string) {
  await page.getByRole('link', { name: label, exact: true }).click()
  await page.waitForLoadState('networkidle')
}

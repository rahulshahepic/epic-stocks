import { type Page, type APIRequestContext, expect } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
const API_BASE = process.env.E2E_API_URL ?? BASE_URL

/**
 * Register a test user via the E2E test-login endpoint and return the JWT token.
 * Useful for direct API calls that need a Bearer token (e.g. seeding data before loginAs).
 */
export async function getTestToken(request: APIRequestContext, email: string, name = 'Test User'): Promise<string> {
  const resp = await request.post(`${API_BASE}/api/auth/test-login`, {
    data: { email, name },
  })
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  return body.access_token
}

/**
 * Log in as a user in the browser. Navigates to the test-login-redirect endpoint
 * which sets the HttpOnly session cookie server-side and redirects to /.
 */
export async function loginAs(page: Page, email: string, name = 'Test User') {
  const params = new URLSearchParams({ email, name })
  await page.goto(`${BASE_URL}/api/auth/test-login-redirect?${params}`)
  await page.waitForURL('**/')
  await page.waitForLoadState('networkidle')
}

/** Navigate to a page via the nav bar */
export async function navigateTo(page: Page, label: string) {
  await page.getByRole('navigation').getByRole('link', { name: label, exact: true }).click()
  await page.waitForLoadState('networkidle')
}

/** Reset the current user's data (grants, loans, prices) via the API */
export async function resetUserData(request: APIRequestContext, token: string) {
  await request.post(`${API_BASE}/api/me/reset`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

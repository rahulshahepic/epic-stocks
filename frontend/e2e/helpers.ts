import { type Page, expect } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
const API_BASE = process.env.E2E_API_URL ?? BASE_URL

/**
 * Log in as a user. POSTs to test-login via page.request, which shares the
 * browser context so the Set-Cookie response sets the session cookie.
 */
export async function loginAs(page: Page, email: string, name = 'Test User') {
  const resp = await page.request.post(`${API_BASE}/api/auth/test-login`, {
    data: { email, name },
  })
  expect(resp.ok()).toBeTruthy()
  await page.goto(BASE_URL)
  await page.waitForLoadState('networkidle')
}

/** Navigate to a page via the nav bar */
export async function navigateTo(page: Page, label: string) {
  await page.getByRole('navigation').getByRole('link', { name: label, exact: true }).click()
  await page.waitForLoadState('networkidle')
}

/** Reset the current user's data via the API (uses session cookie automatically) */
export async function resetUserData(page: Page) {
  await page.request.post(`${API_BASE}/api/me/reset`)
}

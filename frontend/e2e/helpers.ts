import { type Page, expect } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
const API_BASE = process.env.E2E_API_URL ?? BASE_URL

/**
 * Log in as a user. POSTs to test-login via page.request, which shares the
 * browser context so the Set-Cookie response sets the session cookie.
 *
 * No waitForLoadState('networkidle') here — MaintenanceContext polls
 * /api/status every 15 s, so networkidle adds ~500 ms per call without a
 * meaningful guarantee. Callers' next locator interaction auto-waits for
 * the element to be actionable, which already covers hydration.
 */
export async function loginAs(page: Page, email: string, name = 'Test User') {
  const resp = await page.request.post(`${API_BASE}/api/auth/test-login`, {
    data: { email, name },
  })
  expect(resp.ok()).toBeTruthy()
  await page.goto(BASE_URL)
}

/** Navigate to a page via the nav bar */
export async function navigateTo(page: Page, label: string) {
  const link = page.getByRole('navigation').getByRole('link', { name: label, exact: true })
  // Derive the expected pathname from the link's own href instead of guessing
  // from the label — Dashboard is "/" not "/dashboard", and we don't want to
  // hard-code mappings here.
  const href = await link.getAttribute('href')
  await link.click()
  // Wait for the route to actually commit before returning. Without this the
  // caller's next assertion races the click → router-state-update →
  // component-mount → first fetch chain, which under CI load can exceed a
  // tight per-assertion timeout (see multi-user.spec.ts).
  if (href) {
    await page.waitForURL(url => url.pathname === href)
  }
}

/** Reset the current user's data via the API (uses session cookie automatically) */
export async function resetUserData(page: Page) {
  await page.request.post(`${API_BASE}/api/me/reset`)
}

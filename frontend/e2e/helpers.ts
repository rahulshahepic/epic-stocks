import { type Page, expect } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
const API_BASE = process.env.E2E_API_URL ?? BASE_URL

/**
 * Log in as a user. POSTs to test-login via page.request, which shares the
 * browser context so the Set-Cookie response sets the session cookie.
 *
 * Waits for the nav bar to mount before returning. The nav is rendered by
 * the auth-aware shell, so its visibility is a reliable signal that the
 * session cookie has been read and React has hydrated. Without this, a
 * fast-following navigateTo() can race the auth bootstrap.
 */
export async function loginAs(page: Page, email: string, name = 'Test User') {
  const resp = await page.request.post(`${API_BASE}/api/auth/test-login`, {
    data: { email, name },
  })
  expect(resp.ok()).toBeTruthy()
  await page.goto(BASE_URL)
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 })
}

/**
 * Navigate to a page via the nav bar. Returns only after:
 *   1. the URL has updated to the link's href, and
 *   2. the new page's "Loading..." placeholder has cleared.
 *
 * Pages render `<p>Loading...</p>` while their initial useApiData fetch is
 * in flight; if we let the caller's next assertion start before that
 * resolves, the assertion sits on `Loading...` and only sees real content
 * once the fetch lands. Under 4-worker CI contention against a single
 * backend, that fetch can take many seconds, which is what previously
 * forced ever-larger per-assertion timeouts in callers. Waiting for the
 * spinner to detach here removes the race entirely and lets callers use
 * tight timeouts that fail fast on real bugs.
 */
export async function navigateTo(page: Page, label: string) {
  const link = page.getByRole('navigation').getByRole('link', { name: label, exact: true })
  // Derive the expected pathname from the link's own href instead of guessing
  // from the label — Dashboard is "/" not "/dashboard", and we don't want to
  // hard-code mappings here.
  const href = await link.getAttribute('href')
  await link.click()
  if (href) {
    await page.waitForURL(url => url.pathname === href)
  }
  // toBeHidden passes when the locator matches zero elements, so a page
  // whose fetch resolves before we check (or that has no Loading state at
  // all) is a no-op. If Loading is showing, we wait for it to detach.
  await expect(page.getByText('Loading...', { exact: true }).first())
    .toBeHidden({ timeout: 30_000 })
}

/** Reset the current user's data via the API (uses session cookie automatically) */
export async function resetUserData(page: Page) {
  await page.request.post(`${API_BASE}/api/me/reset`)
}

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
 *
 * Also waits for the app's one-time /api/config fetch (useConfig) to land.
 * That fetch carries epic_mode and is cached at module scope for the life
 * of the page, independent of any per-page "Loading..." indicator, so
 * navigateTo() can't see it. Without waiting here, an epic_mode-gated
 * assertion (e.g. the Sell/Edit button on Grants) can run while config is
 * still null, rendering the pre-epic-mode default — a race that only
 * surfaces under CI contention and disappears on Playwright's retry.
 */
export async function loginAs(page: Page, email: string, name = 'Test User') {
  const resp = await page.request.post(`${API_BASE}/api/auth/test-login`, {
    data: { email, name },
  })
  const body = await resp.text().catch(() => '(unreadable)')
  expect(resp.ok(), `test-login ${email} → HTTP ${resp.status()}: ${body}`).toBeTruthy()
  const configResponse = page.waitForResponse(r => r.url().includes('/api/config'), { timeout: 15_000 })
  await page.goto(BASE_URL)
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 })
  await configResponse
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
  // Two-phase wait: first, give the page component up to 2 s to mount and
  // show its "Loading..." placeholder (catching the race where waitForURL
  // resolves before React has rendered the new route). If Loading... never
  // appears within that window the fetch was already done — fine. Then wait
  // for Loading... to detach, which signals the initial API fetch is done.
  const loading = page.getByText('Loading...', { exact: true }).first()
  await loading.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => { /* already gone or never shown */ })
  await expect(loading).toBeHidden({ timeout: 30_000 })
}

/** Reset the current user's data via the API (uses session cookie automatically) */
export async function resetUserData(page: Page) {
  await page.request.post(`${API_BASE}/api/me/reset`)
}

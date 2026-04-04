/**
 * Accessibility audit (axe-core) — runs on every major page.
 * Asserts zero critical/serious violations.
 */
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, navigateTo, resetUserData } from './helpers.ts'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

test.describe('Accessibility audit', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'axe-user@example.com', 'Axe User')
    await resetUserData(page)
  })

  async function auditPage(page: Parameters<typeof AxeBuilder>[0]['page'], label: string) {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    const criticalOrSerious = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious',
    )

    if (criticalOrSerious.length > 0) {
      const summary = criticalOrSerious
        .map(v => `[${v.impact}] ${v.id}: ${v.description}\n  ${v.nodes.slice(0, 2).map(n => n.html).join('\n  ')}`)
        .join('\n\n')
      throw new Error(`${label} has ${criticalOrSerious.length} critical/serious a11y violation(s):\n\n${summary}`)
    }

    expect(criticalOrSerious).toHaveLength(0)
  }

  test('Login page', async ({ page }) => {
    // Log out first so we can see the login page
    await page.request.post(`${BASE_URL}/api/auth/logout`).catch(() => {})
    await page.goto(`${BASE_URL}/login`)
    await page.waitForLoadState('networkidle')
    await auditPage(page, 'Login')
  })

  test('Dashboard', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
    await auditPage(page, 'Dashboard')
  })

  test('Events', async ({ page }) => {
    await navigateTo(page, 'Events')
    await auditPage(page, 'Events')
  })

  test('Grants', async ({ page }) => {
    await navigateTo(page, 'Grants')
    await auditPage(page, 'Grants')
  })

  test('Loans', async ({ page }) => {
    await navigateTo(page, 'Loans')
    await auditPage(page, 'Loans')
  })

  test('Prices', async ({ page }) => {
    await navigateTo(page, 'Prices')
    await auditPage(page, 'Prices')
  })

  test('Sales', async ({ page }) => {
    await navigateTo(page, 'Sales')
    await auditPage(page, 'Sales')
  })

  test('Import', async ({ page }) => {
    await navigateTo(page, 'Import')
    await auditPage(page, 'Import')
  })

  test('Settings', async ({ page }) => {
    await navigateTo(page, 'Settings')
    await auditPage(page, 'Settings')
  })
})

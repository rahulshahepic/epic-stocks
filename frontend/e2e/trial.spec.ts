/**
 * E2E test for the no-account trial preview (/try).
 *
 * Uploads Epic's own synthetic fixture files with no login at all, and checks
 * the computed timeline renders in the browser. Then checks that choosing to
 * save routes to /login with the computed data stashed for signup to pick up.
 */
import { test, expect } from '@playwright/test'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CSV_PATH = path.resolve(__dirname, '../../test_data/epic_share_summary.csv')
const PDF_PATH = path.resolve(__dirname, '../../test_data/epic_loan_statement.pdf')

test.describe('No-account trial (/try)', () => {
  test('reads Epic files and computes a timeline with no sign-in at all', async ({ page }) => {
    await page.goto('/try')

    // No account exists, and none is required to get here.
    await expect(page.getByText('No account needed')).toBeVisible()
    expect(await page.context().cookies()).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ name: 'auth_hint' })])
    )

    await page.locator('#trial-csv').setInputFiles(CSV_PATH)
    await page.locator('#trial-pdf').setInputFiles(PDF_PATH)
    await page.getByRole('button', { name: 'See my numbers' }).click()

    // Computed figures a person recognizes, not a file dump.
    await expect(page.getByRole('definition').filter({ hasText: '679,000' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Everything reconciles against the totals in your own paperwork.')).toBeVisible()
    await expect(page.getByText('Vesting').first()).toBeVisible()

    // Still nobody logged in — the preview itself never required it.
    expect(await page.context().cookies()).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ name: 'auth_hint' })])
    )
  })

  test('saving the preview stashes the computed data and sends you to sign in', async ({ page }) => {
    await page.goto('/try')
    await page.locator('#trial-csv').setInputFiles(CSV_PATH)
    await page.locator('#trial-pdf').setInputFiles(PDF_PATH)
    await page.getByRole('button', { name: 'See my numbers' }).click()

    await expect(page.getByRole('button', { name: /Save my numbers/i })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /Save my numbers/i }).click()

    await expect(page).toHaveURL(/\/login$/)
    const stashed = await page.evaluate(() => sessionStorage.getItem('trial_wizard_payload'))
    expect(stashed).not.toBeNull()
    const payload = JSON.parse(stashed as string)
    expect(payload.grants).toHaveLength(8)
    expect(payload.prices).toHaveLength(3)
  })

  test('the login page offers the trial as a lower-commitment path in, and back again', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: /Try it with your own files/i }).click()
    await expect(page).toHaveURL(/\/try$/)
    await page.getByRole('link', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/login$/)
  })
})

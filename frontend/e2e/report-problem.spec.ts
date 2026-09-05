/**
 * E2E for problem reporting: the pre-login path (someone who cannot sign in
 * still has to be able to say so), and the admin end of it.
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers'

const ADMIN_EMAIL = 'admin@e2e.test'

test.describe('Reporting a problem', () => {
  test('can be sent from the login page with no account at all', async ({ page }) => {
    await page.goto('/login')

    expect(await page.context().cookies()).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ name: 'auth_hint' })])
    )

    await page.getByRole('button', { name: 'Report a problem' }).click()
    const dialog = page.getByRole('dialog', { name: 'Report a problem' })
    await expect(dialog).toBeVisible()

    // Identifying details are opt-in, and start off.
    await expect(dialog.getByRole('checkbox')).not.toBeChecked()

    await dialog.getByPlaceholder('What were you doing when it broke?')
      .fill('Sign in with Google bounces me back to the login page.')
    await dialog.getByPlaceholder('you@example.com').fill('locked-out@example.com')
    await dialog.getByRole('button', { name: 'Send report' }).click()

    await expect(dialog.getByText(/went straight to the maintainer/)).toBeVisible()
  })

  test('shows the payload before sending, and hides details until asked', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Report a problem' }).click()
    const dialog = page.getByRole('dialog', { name: 'Report a problem' })

    await dialog.getByRole('button', { name: /Show exactly what gets sent/ }).click()
    await expect(dialog.getByText(/account, browser and recent activity: not included/)).toBeVisible()

    await dialog.getByRole('checkbox').check()
    await expect(dialog.getByText(/recent activity:/)).toBeVisible()
  })

  test('reaches the admin dashboard, and can be resolved there', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Report a problem' }).click()
    const dialog = page.getByRole('dialog', { name: 'Report a problem' })
    await dialog.getByPlaceholder('What were you doing when it broke?')
      .fill('E2E: the events page will not load')
    await dialog.getByRole('button', { name: 'Send report' }).click()
    await expect(dialog.getByText(/went straight to the maintainer/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Close' }).click()

    await loginAs(page, ADMIN_EMAIL, 'Admin')
    await page.goto('/admin')

    const report = page.getByText('E2E: the events page will not load')
    await expect(report).toBeVisible({ timeout: 15_000 })

    await report.click()
    await page.getByRole('button', { name: 'Mark resolved' }).click()
    await expect(report).toBeHidden()

    await page.getByRole('button', { name: 'Show resolved' }).click()
    await expect(report).toBeVisible()
  })

  test('the footer offers it on every page once signed in', async ({ page }) => {
    await loginAs(page, 'reporter@e2e.test', 'Reporter')
    await expect(page.getByRole('button', { name: 'Report a problem' })).toBeVisible()
  })
})

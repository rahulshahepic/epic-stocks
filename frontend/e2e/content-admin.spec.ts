/**
 * E2E tests for the content-admin role and /content editor.
 * Requires backend started with E2E_TEST=1 and ADMIN_EMAIL=admin@e2e.test.
 */
import { test, expect, request as playwrightRequest } from '@playwright/test'
import { loginAs, navigateTo } from './helpers'

const ADMIN_EMAIL = 'admin@e2e.test'
const API_BASE = process.env.E2E_API_URL ?? process.env.E2E_BASE_URL ?? 'http://localhost:5173'

async function createUser(email: string, name: string) {
  const ctx = await playwrightRequest.newContext()
  await ctx.post(`${API_BASE}/api/auth/test-login`, { data: { email, name } })
  await ctx.dispose()
}

test.describe('Content admin role', () => {
  test('non-admin does not see the Content nav link', async ({ page }) => {
    await loginAs(page, 'content-regular@e2e.test', 'Regular User')
    await expect(page.getByRole('link', { name: 'Content', exact: true })).not.toBeVisible()
  })

  test('admin promotes a user to content admin and they can edit', async ({ page, browser }) => {
    const editorEmail = 'content-editor@e2e.test'
    await createUser(editorEmail, 'Editor')

    // Admin logs in, opens user detail, promotes editor
    await loginAs(page, ADMIN_EMAIL, 'Admin User')
    await navigateTo(page, 'Admin')
    await page.getByPlaceholder('Search by email or name...').fill(editorEmail)
    await expect(page.getByText(editorEmail).first()).toBeVisible()
    await page.getByText(editorEmail).first().click()
    await expect(page.getByText('Actions')).toBeVisible()
    await page.getByRole('button', { name: 'Make Content Admin' }).click()
    // Button flips to Revoke
    await expect(page.getByRole('button', { name: 'Revoke Content Admin' })).toBeVisible()

    // Editor logs in (fresh browser context), sees /content, edits settings
    const editorCtx = await browser.newContext()
    const editorPage = await editorCtx.newPage()
    await loginAs(editorPage, editorEmail, 'Editor')
    await expect(editorPage.getByRole('link', { name: 'Content', exact: true })).toBeVisible()
    await navigateTo(editorPage, 'Content')
    await expect(editorPage.getByText('Grant-program content')).toBeVisible()

    // Change flexible-payoff toggle and save
    await editorPage.getByRole('button', { name: 'Program Settings' }).click()
    await editorPage.getByLabel(/Flexible loan-payoff methods/).check()
    await editorPage.getByRole('button', { name: 'Save settings' }).click()
    await expect(editorPage.getByText('Program settings saved')).toBeVisible()

    await editorCtx.close()
  })
})

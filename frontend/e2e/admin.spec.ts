/**
 * E2E tests for admin workflows: user list, delete user, block/unblock email.
 * Requires backend started with E2E_TEST=1 and ADMIN_EMAIL=admin@e2e.test.
 */
import { test, expect } from '@playwright/test'
import { getTestToken, loginAs, navigateTo } from './helpers'

const ADMIN_EMAIL = 'admin@e2e.test'

test.describe('Admin workflows', () => {
  test('admin sees user list and can search', async ({ page, request }) => {
    await getTestToken(request, ADMIN_EMAIL, 'Admin User')
    await getTestToken(request, 'admin-search-target@e2e.test', 'Search Target')
    const adminToken = await getTestToken(request, ADMIN_EMAIL, 'Admin User')

    await loginAs(page, adminToken)
    await navigateTo(page, 'Admin')

    // Target user should appear in the list
    await expect(page.getByText('admin-search-target@e2e.test')).toBeVisible()

    // Search narrows the list
    await page.getByPlaceholder('Search by email or name...').fill('admin-search-target')
    await expect(page.getByText('admin-search-target@e2e.test')).toBeVisible()

    // Non-matching search hides the user
    await page.getByPlaceholder('Search by email or name...').fill('zzz-no-match-zzz')
    await expect(page.getByText('admin-search-target@e2e.test')).not.toBeVisible()
  })

  test('admin can delete a non-admin user (two-click confirm)', async ({ page, request }) => {
    await getTestToken(request, 'admin-delete-target@e2e.test', 'Delete Target')
    const adminToken = await getTestToken(request, ADMIN_EMAIL, 'Admin User')

    await loginAs(page, adminToken)
    await navigateTo(page, 'Admin')

    // Find the target user via search
    await page.getByPlaceholder('Search by email or name...').fill('admin-delete-target@e2e.test')
    await expect(page.getByText('admin-delete-target@e2e.test')).toBeVisible()

    // First click: button changes to "Confirm Delete"
    await page.getByRole('button', { name: 'Delete' }).first().click()
    await expect(page.getByRole('button', { name: 'Confirm Delete' })).toBeVisible()

    // Second click: user is deleted and disappears from the list
    await page.getByRole('button', { name: 'Confirm Delete' }).click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('admin-delete-target@e2e.test')).not.toBeVisible()
  })

  test('admin can block and unblock an email address', async ({ page, request }) => {
    const adminToken = await getTestToken(request, ADMIN_EMAIL, 'Admin User')

    await loginAs(page, adminToken)
    await navigateTo(page, 'Admin')

    // Block an email
    await page.getByPlaceholder('email@example.com').fill('e2e-blocked@example.com')
    await page.getByPlaceholder('Reason (optional)').fill('E2E test block')
    await page.locator('form').filter({ hasText: 'e2e-blocked@example.com' }).getByRole('button').click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('e2e-blocked@example.com')).toBeVisible()

    // Unblock it
    const blockedRow = page.locator('li, tr').filter({ hasText: 'e2e-blocked@example.com' })
    await blockedRow.getByRole('button', { name: 'Unblock' }).click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('e2e-blocked@example.com')).not.toBeVisible()
  })

  test('non-admin cannot access admin dashboard', async ({ page, request }) => {
    const userToken = await getTestToken(request, 'non-admin@e2e.test', 'Regular User')

    await loginAs(page, userToken)

    // Admin nav link should not be visible
    await expect(page.getByRole('link', { name: 'Admin', exact: true })).not.toBeVisible()

    // Direct navigation to /admin should redirect or show 403-like state
    await page.goto('/admin')
    await page.waitForLoadState('networkidle')
    // Should not show admin content
    await expect(page.getByPlaceholder('Search by email or name...')).not.toBeVisible()
  })
})

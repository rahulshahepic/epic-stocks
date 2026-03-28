/**
 * E2E tests for admin workflows: user list, delete user, block/unblock email.
 * Requires backend started with E2E_TEST=1 and ADMIN_EMAIL=admin@e2e.test.
 */
import { test, expect } from '@playwright/test'
import { getTestToken, loginAs, navigateTo } from './helpers'

const ADMIN_EMAIL = 'admin@e2e.test'

test.describe('Admin workflows', () => {
  test('admin sees user list and can search', async ({ page, request }) => {
    await getTestToken(request, 'admin-search-target@e2e.test', 'Search Target')

    await loginAs(page, ADMIN_EMAIL, 'Admin User')
    await navigateTo(page, 'Admin')

    // Target user should appear in the list
    await expect(page.getByText('admin-search-target@e2e.test').first()).toBeVisible()

    // Search narrows the list
    await page.getByPlaceholder('Search by email or name...').fill('admin-search-target')
    await expect(page.getByText('admin-search-target@e2e.test').first()).toBeVisible()

    // Non-matching search hides the user
    await page.getByPlaceholder('Search by email or name...').fill('zzz-no-match-zzz')
    await expect(page.getByText('admin-search-target@e2e.test').first()).not.toBeVisible()
  })

  test('admin can delete a non-admin user (two-click confirm)', async ({ page, request }) => {
    await getTestToken(request, 'admin-delete-target@e2e.test', 'Delete Target')

    await loginAs(page, ADMIN_EMAIL, 'Admin User')
    await navigateTo(page, 'Admin')

    // Search to isolate the target user
    await page.getByPlaceholder('Search by email or name...').fill('admin-delete-target@e2e.test')
    await expect(page.getByText('admin-delete-target@e2e.test').first()).toBeVisible()

    // First click: button changes to "Confirm Delete"
    await page.getByRole('button', { name: 'Delete' }).first().click()
    await expect(page.getByRole('button', { name: 'Confirm Delete' })).toBeVisible()

    // Second click: user is deleted and disappears from the list
    await page.getByRole('button', { name: 'Confirm Delete' }).click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('admin-delete-target@e2e.test').first()).not.toBeVisible()
  })

  test('admin can block and unblock an email address', async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, 'Admin User')
    await navigateTo(page, 'Admin')

    // Block an email — fill the form and click the submit button inside it
    await page.getByPlaceholder('email@example.com').fill('e2e-blocked@example.com')
    await page.getByPlaceholder('Reason (optional)').fill('E2E test block')
    await page.getByPlaceholder('email@example.com').press('Enter')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('e2e-blocked@example.com').first()).toBeVisible()

    // Unblock it
    await page.getByRole('button', { name: 'Unblock' }).first().click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('e2e-blocked@example.com').first()).not.toBeVisible()
  })

  test('non-admin cannot access admin dashboard', async ({ page }) => {
    await loginAs(page, 'non-admin@e2e.test', 'Regular User')

    // Admin nav link should not be visible
    await expect(page.getByRole('link', { name: 'Admin', exact: true })).not.toBeVisible()

    // Direct navigation to /admin should not show admin content
    await page.goto('/admin')
    await page.waitForLoadState('networkidle')
    await expect(page.getByPlaceholder('Search by email or name...')).not.toBeVisible()
  })
})

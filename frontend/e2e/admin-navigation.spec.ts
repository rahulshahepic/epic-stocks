import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, navigateTo } from './helpers.ts'

test('mobile Site Admin opens one category at a time and restores focus', async ({ page }) => {
  await loginAs(page, 'admin@e2e.test')
  await navigateTo(page, 'Site Admin')
  const categories = page.getByRole('navigation', { name: 'Site Admin categories' })
  await expect(categories.getByRole('link')).toHaveCount(6)
  await expect(page.getByRole('heading', { name: /Danger Zone/ })).toHaveCount(0)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

  await categories.getByRole('link', { name: /^Reports & Errors/ }).click()
  await expect(page).toHaveURL(/\/admin#support$/)
  await expect(page.getByRole('region', { name: 'Reports & Errors' })).toBeFocused()
  await expect(categories).toBeHidden()
  await expect(page.getByRole('heading', { name: /Problem Reports/ })).toBeVisible()
  expect((await new AxeBuilder({ page }).include('[aria-label="Reports & Errors"]').analyze()).violations).toEqual([])
  await expect(page.getByPlaceholder('Search by email or name...')).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('heading', { name: /Problem Reports/ })).toBeVisible()
  await page.getByRole('link', { name: 'Back to Site Admin' }).click()
  await expect(page.getByRole('heading', { name: 'Site Admin', exact: true })).toBeFocused()
  await page.goBack()
  await expect(page.getByRole('region', { name: 'Reports & Errors' })).toBeFocused()
})

test('desktop Content Admin keeps its categories visible on a direct link', async ({ page }) => {
  await loginAs(page, 'admin@e2e.test')
  await page.setViewportSize({ width: 1280, height: 600 })
  await page.goto('/content#templates')
  const categories = page.getByRole('navigation', { name: 'Content Admin categories' })
  await expect(categories.getByRole('link', { name: /^Grant Templates/ })).toHaveAttribute('aria-current', 'location')
  await expect(page.getByRole('button', { name: /Add template/ })).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 280))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(180)
  await expect(categories.getByRole('link', { name: /^Grant Templates/ })).toBeInViewport({ ratio: 1 })
  await categories.getByRole('link', { name: /^Program Settings/ }).click()
  await expect(page).toHaveURL(/\/content#settings$/)
  await expect(page.getByRole('heading', { name: 'Program Settings', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Add template/ })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('an admin notice link survives sign-in', async ({ page }) => {
  await page.goto('/admin#ai-connections')
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%23ai-connections$/)
  const response = await page.request.post('/api/auth/test-login', { data: { email: 'admin@e2e.test' } })
  expect(response.ok()).toBe(true)
  await page.reload()
  await expect(page).toHaveURL(/\/admin#ai-connections$/)
  await expect(page.getByRole('region', { name: 'AI Connections', exact: true })).toBeVisible()
})

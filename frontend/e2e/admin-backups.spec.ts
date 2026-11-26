import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs, navigateTo } from './helpers'
import { backupStatus } from './backup-fixtures'

test('Admin can configure backups on a phone and sees cleanup and restore status separately', async ({ page }) => {
  let settings = structuredClone(backupStatus.settings)
  let saved = false
  await page.route('**/api/admin/backups**', async route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON()
      expect(body.expected_revision).toBe('a'.repeat(64))
      expect(Object.keys(body).sort()).toEqual(['account_id', 'bucket', 'enabled', 'expected_revision', 'recipient', 'retention_days'])
      settings = { enabled: body.enabled, account_id: body.account_id, bucket: body.bucket, recipient: body.recipient, retention_days: body.retention_days }
      saved = true
    }
    await route.fulfill({ json: { ...backupStatus, settings, state: saved ? 'pending' : 'succeeded' } })
  })
  await loginAs(page, process.env.SCREENSHOT_EMAIL || 'admin@e2e.test')
  await navigateTo(page, 'Site Admin')
  await page.getByRole('link', { name: /^Maintenance & Backups/ }).click()
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Backups', exact: true }) })
  await expect(panel.getByText('Last backup uploaded successfully')).toBeVisible()
  await expect(panel.getByRole('alert')).toContainText('Retention cleanup failed')
  await expect(panel.getByText(/No successful test restore recorded/)).toBeVisible()
  await panel.getByRole('button', { name: 'Configure backups' }).click()
  await panel.getByLabel('Retention in days').fill('45')
  await expect(panel.getByLabel('Public encryption key')).toHaveValue(backupStatus.settings.recipient)
  await expect(panel.locator('input[type=password]')).toHaveCount(0)
  await panel.evaluate(element => { element.id = 'admin-backup-panel' })
  const audit = await new AxeBuilder({ page }).include('#admin-backup-panel').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(audit.violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await panel.getByRole('button', { name: 'Save backup settings' }).click()
  await expect(panel.getByText('Settings saved; waiting for the host')).toBeVisible()
  await expect(panel.getByText(/Keep 45 days/)).toBeVisible()
  expect(saved).toBe(true)
})

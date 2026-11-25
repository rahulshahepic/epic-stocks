import { expect, test } from '@playwright/test'
import { openFailedImportReport, REPORT_CSV } from './reporting-fixture'

test.skip(!process.env.E2E_KEY_ENCRYPTION_KEY && !process.env.SCREENSHOT_EMAIL,
  'Requires the encrypted-report browser fixture')

test('failed import report discloses options, sends only selected files and supports browser admin retrieval', async ({ page }) => {
  const dialog = await openFailedImportReport(page)
  const github = dialog.getByRole('link', { name: 'Open a public GitHub issue' })
  await expect(github).toHaveAttribute('href', 'https://github.com/rahulshahepic/epic-stocks/issues/new/choose')
  const diagnostics = dialog.getByRole('checkbox', { name: /Include account and diagnostic details/ })
  const attachments = dialog.getByRole('checkbox', { name: /Attach the original import files/ })
  await expect(diagnostics).not.toBeChecked()
  await expect(attachments).not.toBeChecked()
  await attachments.check()
  await dialog.getByRole('button', { name: 'Remove fictional-statement.pdf' }).click()
  const sent = page.waitForResponse(response => response.url().endsWith('/api/report/with-consent'))
  await dialog.getByRole('button', { name: 'Send report' }).click()
  const response = await sent
  expect(response.ok()).toBeTruthy()
  const { id } = await response.json()
  await expect(dialog.getByText('Thanks — that went straight to the maintainer.')).toBeVisible()

  const login = await page.request.post('/api/auth/test-login', { data: { email: 'admin@e2e.test', name: 'Test Admin' } })
  expect(login.ok()).toBeTruthy()
  await page.goto('/admin')
  const row = page.getByRole('button', { name: /private report with consented material/i }).first()
  await row.click()
  await page.getByRole('button', { name: 'Open private details' }).click()
  await expect(page.getByText('fictional-grants.csv')).toBeVisible()
  await expect(page.getByText('fictional-statement.pdf')).toHaveCount(0)
  await page.getByRole('button', { name: 'View text' }).click()
  await expect(page.locator('pre').filter({ hasText: 'Fictional grant,321,25.50' })).toBeVisible()

  const privateReport = await page.request.get(`/api/admin/reports/${id}/sensitive`)
  const { documents } = await privateReport.json()
  const original = await page.request.get(`/api/admin/reports/${id}/sensitive/documents/${documents[0].id}`)
  expect((await original.body()).toString()).toBe(REPORT_CSV)

  await page.getByRole('button', { name: 'Delete sensitive material…' }).click()
  await page.getByRole('button', { name: 'Delete private material' }).click()
  await expect.poll(async () => (await page.request.get(`/api/admin/reports/${id}/sensitive`)).status()).toBe(404)
})

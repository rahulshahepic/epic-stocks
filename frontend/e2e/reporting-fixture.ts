import { expect, type Page } from '@playwright/test'

export const REPORT_CSV = 'grant,shares,price\nFictional grant,321,25.50\n'

export async function openFailedImportReport(page: Page, base = '') {
  await page.goto(`${base}/try`)
  await page.getByLabel('Stock files (.csv, .xlsx, .pdf)').setInputFiles([
    { name: 'fictional-grants.csv', mimeType: 'text/csv', buffer: Buffer.from(REPORT_CSV) },
    { name: 'fictional-statement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') },
  ])
  await page.getByRole('button', { name: 'See my numbers' }).click()
  await page.getByRole('button', { name: /^Report this(?: import problem)?$/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Report a problem' })
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('What were you doing when it broke?').fill('The preview could not read my fictional grant.')
  return dialog
}

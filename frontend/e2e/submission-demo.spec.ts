/** Supplemental website recording. Run via the required screenshot runner. */
import { test, expect } from '@playwright/test'
import { mkdir, rm } from 'node:fs/promises'

test('capture fictional website walkthrough', async ({ browser }) => {
  test.skip(process.env.SUBMISSION_DEMO_CAPTURE !== '1', 'Opt-in recording only')
  test.setTimeout(90_000)
  const folder = '../frontend/public/review'
  await mkdir(folder, { recursive: true })
  const context = await browser.newContext({
    baseURL: process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1280, height: 800 }, colorScheme: 'light',
    recordVideo: { dir: '../test-results/submission-video', size: { width: 1280, height: 800 } },
  })
  const page = await context.newPage()
  const video = page.video()!
  try {
    await page.goto('/demo')
    await expect(page.getByText('Loading fictional profile…')).toHaveCount(0)
    await expect(page.getByText('Estimated cash if leaving', { exact: false })).toBeVisible()
    await page.waitForTimeout(2_000) // Deliberate viewing time in the recording.
    await page.getByText('Estimated cash if leaving', { exact: false }).scrollIntoViewIfNeeded()
    await page.waitForTimeout(5_000)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.getByRole('button', { name: 'Sale what-if' }).click()
    await page.getByLabel('Shares to sell').fill('100')
    await page.getByRole('button', { name: 'Estimate sale' }).click()
    await expect(page.getByLabel('Sale estimate')).toBeVisible()
    await page.getByLabel('Sale estimate').scrollIntoViewIfNeeded()
    await page.waitForTimeout(5_000)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.getByRole('button', { name: 'Events', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Fictional stock timeline' })).toBeVisible()
    await page.getByRole('heading', { name: 'Fictional stock timeline' }).scrollIntoViewIfNeeded()
    await page.waitForTimeout(5_000)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.getByRole('button', { name: /Planning an exit/ }).click()
    await expect(page.getByText('Loading fictional profile…')).toHaveCount(0)
    await page.getByRole('button', { name: 'Retirement', exact: true }).click()
    await page.getByRole('button', { name: 'Run simulation' }).click()
    await expect(page.getByLabel('Retirement results')).toBeVisible({ timeout: 25_000 })
    await page.getByLabel('Retirement results').scrollIntoViewIfNeeded()
    await page.waitForTimeout(7_000)
  } finally {
    await context.close()
  }
  const target = `${folder}/epic-stocks-website-demo.webm`
  await rm(target, { force: true })
  await video.saveAs(target)
})

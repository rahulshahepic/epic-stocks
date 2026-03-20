/**
 * Capture README screenshots. Run via: ./screenshots/run.sh
 */
import { test, type Page } from '@playwright/test'

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:5173'
const TOKEN = process.env.SCREENSHOT_TOKEN ?? ''
const OUT = '../screenshots'

const MOBILE = { width: 375, height: 812 }
const DESKTOP = { width: 1280, height: 800 }

async function authedPage(page: Page, viewport: { width: number; height: number }, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme })
  await page.setViewportSize(viewport)
  await page.goto(BASE)
  await page.evaluate((t: string) => localStorage.setItem('auth_token', t), TOKEN)
  await page.goto(BASE)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
}

test('dashboard - light - mobile', async ({ page }) => {
  await authedPage(page, MOBILE, 'light')
  await page.screenshot({ path: `${OUT}/dashboard-light-mobile.png`, fullPage: true })
})

test('dashboard - dark - mobile', async ({ page }) => {
  await authedPage(page, MOBILE, 'dark')
  await page.screenshot({ path: `${OUT}/dashboard-dark-mobile.png`, fullPage: true })
})

test('dashboard - light - desktop', async ({ page }) => {
  await authedPage(page, DESKTOP, 'light')
  await page.screenshot({ path: `${OUT}/dashboard-light-desktop.png`, fullPage: true })
})

test('dashboard - dark - desktop', async ({ page }) => {
  await authedPage(page, DESKTOP, 'dark')
  await page.screenshot({ path: `${OUT}/dashboard-dark-desktop.png`, fullPage: true })
})

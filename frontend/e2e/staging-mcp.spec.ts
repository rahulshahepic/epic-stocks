import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

async function capture(page: Page, file: string) {
  await page.evaluate(() => new Promise<void>(resolve => { window.scrollTo(0, 0); requestAnimationFrame(() => requestAnimationFrame(() => resolve())) }))
  await page.screenshot({ path: file, fullPage: true, style: '[aria-label="Mobile navigation"]{visibility:hidden!important}' })
}

for (const theme of ['light', 'dark'] as const) {
  for (const device of ['mobile', 'desktop'] as const) {
    test(`staging fake account and MCP setup ${theme} ${device}`, async ({ page }) => {
      test.skip(!(await (await page.request.get('/api/config')).json()).staging_demo, 'Staging-only workflow')
      await page.emulateMedia({ colorScheme: theme })
      await page.setViewportSize(device === 'mobile' ? { width: 375, height: 812 } : { width: 1280, height: 900 })
      await page.goto('/mcp-setup')
      await expect(page.getByRole('heading', { name: /MCP setup/ })).toBeVisible()
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      await capture(page, `../screenshots/mcp-public-setup-${theme}-${device}.png`)
      await page.request.post('/api/auth/test-login', { data: { email: `seed-${theme}-${device}-${test.info().retry}@e2e.test`, name: 'Fictional Test User' } })
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Set up a fictional staging account' })).toBeVisible()
      await capture(page, `../screenshots/staging-seed-${theme}-${device}.png`)
      const seeded = page.waitForResponse(r => r.url().endsWith('/api/demo/seed') && r.request().method() === 'POST')
      await page.getByRole('button', { name: /Load Established/ }).click()
      expect((await seeded).status()).toBe(200)
      await expect(page.getByRole('heading', { name: 'Set up a fictional staging account' })).toHaveCount(0)
      await expect(page.getByText('Staging environment — fictional test data')).toBeVisible()
      await expect(page.getByText('Estimated cash from leaving on this date', { exact: false })).toBeVisible()
      await page.goto('/connect-ai')
      await expect(page.getByRole('heading', { name: 'Staging test connector' })).toBeVisible()
      await page.getByLabel('Your assistant').selectOption('chatgpt')
      await expect(page.getByRole('link', { name: 'download the staging ChatGPT plugin' })).toHaveAttribute('href', '/api/ai/plugin/chatgpt')
      await expect(page.getByRole('link', { name: 'download the staging ChatGPT plugin' })).toHaveAttribute('download', 'epic-stocks-staging-test-chatgpt.zip')
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
      await capture(page, `../screenshots/staging-connect-ai-${theme}-${device}.png`)
      expect((await page.request.post('/api/demo/seed', { data: { profile: 'early' } })).status()).toBe(409)
    })
  }
}

test('public setup is discoverable before signing in', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: 'Connect an AI assistant — setup guide' }).click()
  await expect(page.getByRole('heading', { name: /MCP setup/ })).toBeVisible()
  const doc = await (await page.request.get('/mcp/setup.json')).json()
  expect(doc.transport).toBe('streamable-http')
  expect(doc.authentication.type).toBe('oauth2')
  expect((await page.request.get('/api/grants')).status()).toBe(401)
  expect((await page.request.get('/robots.txt')).status()).toBe(200)
  expect((await page.request.get('/llms.txt')).status()).toBe(200)
})


for (const theme of ['light', 'dark'] as const) {
  test(`unknown OAuth client has setup recovery ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme })
    await page.goto('/oauth/authorize?client_id=unregistered-staging-test')
    await expect(page.getByRole('heading', { name: 'Unknown application' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'MCP setup guide' })).toHaveAttribute('href', '/mcp-setup')
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await capture(page, `../screenshots/oauth-registration-recovery-${theme}-mobile.png`)
  })
}

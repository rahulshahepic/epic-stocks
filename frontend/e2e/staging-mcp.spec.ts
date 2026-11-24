import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

test.use({ hasTouch: true })

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


test('mobile fictional workspace persists edits and confirms profile changes', async ({ page }) => {
  test.skip(!(await (await page.request.get('/api/config')).json()).staging_demo, 'Staging-only workflow')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.request.post('/api/auth/test-login', { data: { email: `workspace-mobile-${test.info().retry}@e2e.test`, name: 'Fictional Browser Tester' } })
  await page.goto('/')
  await page.getByRole('button', { name: /Load Early career/ }).tap()
  await expect(page.getByRole('heading', { name: 'Set up a fictional staging account' })).toHaveCount(0)
  expect((await (await page.request.get('/api/grants')).json()).length).toBe(6)
  await page.goto('/retirement')
  const spending = page.getByLabel(/^Default spend/)
  await expect(spending).toBeVisible()
  let busyInjected = false
  await page.route('**/api/retirement/params', async route => {
    if (route.request().method() === 'PUT' && !busyInjected) {
      busyInjected = true
      await route.fulfill({ status: 409, headers: { 'Retry-After': '1' }, contentType: 'application/json', body: JSON.stringify({ detail: 'Synthetic account is busy; retry this request shortly.' }) })
    } else await route.continue()
  })
  await spending.fill('77')
  await spending.press('Tab')
  await expect.poll(async () => (await (await page.request.get('/api/retirement/params')).json()).params.defaultSpend).toBe(77)
  expect(busyInjected).toBe(true)
  await page.reload()
  await expect(page.getByLabel(/^Default spend/)).toHaveValue('77')
  expect((await (await page.request.get('/api/retirement/params')).json()).params.defaultSpend).toBe(77)
  await page.goto('/settings')
  await page.getByRole('button', { name: /Load Established/ }).tap()
  await expect(page.getByRole('button', { name: 'Reset fictional workspace' })).toBeVisible()
  expect((await (await page.request.get('/api/grants')).json()).length).toBe(6)
  await capture(page, '../screenshots/staging-workspace-reset-dark-mobile.png')
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.getByRole('button', { name: 'Keep testing edits' }).tap()
  expect((await (await page.request.get('/api/retirement/params')).json()).params.defaultSpend).toBe(77)
  for (const [label, count] of [['Established', 20], ['Planning an exit', 40]] as const) {
    await page.getByRole('button', { name: `Load ${label}` }).tap()
    await page.getByRole('button', { name: 'Reset fictional workspace' }).tap()
    await expect(page.getByRole('heading', { name: 'Fictional staging workspace' })).toHaveCount(0)
    expect((await (await page.request.get('/api/grants')).json()).length).toBe(count)
    await page.goto('/settings')
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
})

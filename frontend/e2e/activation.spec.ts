import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { loginAs } from './helpers.ts'

const CSV = readFileSync('../test_data/epic_share_summary.csv')
for (const theme of ['light', 'dark'] as const) for (const device of ['mobile', 'desktop'] as const) {
  test(`opted-in attempt and admin report ${theme} ${device}`, async ({page}, testInfo) => {
    await page.emulateMedia({colorScheme: theme})
    await page.setViewportSize(device === 'mobile' ? {width: 375, height: 812} : {width: 1280, height: 900})
    await page.goto('/try')
    const choice = page.getByRole('checkbox', {name: /Share optional onboarding counts/})
    await expect(choice).not.toBeChecked()
    await choice.check()
    await page.locator('#trial-csv').setInputFiles({name: 'fictional.csv', mimeType: 'text/csv', buffer: CSV})
    await page.getByRole('button', {name: 'See my numbers'}).click()
    await expect(page.getByRole('button', {name: /Save my numbers/})).toBeVisible()
    const attempt = await page.evaluate(() => JSON.parse(sessionStorage.getItem('onboarding_attempt_v1') ?? 'null'))
    expect(attempt?.token).toMatch(/^[0-9a-f]{48}$/)
    // Use a fresh authenticated test account and the real confirmed change-set route.
    await page.request.post('/api/auth/test-login', {data: {email: `activation-${theme}-${device}-${testInfo.retry}@example.test`, name: 'Fictional onboarding'}})
    const claim = await page.request.post('/api/onboarding/claim', {data: {token: attempt.token, opt_in: true}})
    await expect.poll(async () => {
      const r = await page.request.post('/api/onboarding/claim', {data: {token: attempt.token, opt_in: true}})
      return (await r.json()).recorded
    }).toBe(true)
    expect(claim.ok()).toBe(true)
    const changes = [{kind: 'price', action: 'create', values: {effective_date: '2026-01-01', price: 100}}]
    const preview = await (await page.request.post('/api/changes/preview', {data: {changes}})).json()
    expect((await page.request.post('/api/changes/apply', {data: {changes, confirm: preview.confirm, onboarding_token: attempt.token}})).ok()).toBe(true)
    // Admin fixture is provided by the screenshot/E2E runner, separate from the test account.
    await page.setViewportSize({width: 375, height: 812})
    await loginAs(page, 'admin@e2e.test')
    await page.setViewportSize(device === 'mobile' ? {width: 375, height: 812} : {width: 1280, height: 900})
    await page.goto('/admin')
    const panel = page.getByRole('heading', {name: 'Onboarding attempts', exact: true}).locator('..')
    await expect(panel.getByText('Import attempts', {exact: true})).toBeVisible()
    await panel.evaluate(el => el.setAttribute('data-onboarding-panel', 'true'))
    expect((await new AxeBuilder({page}).include('[data-onboarding-panel]').analyze()).violations.filter(v => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await panel.screenshot({style: '.sticky, header, [aria-label="Mobile navigation"] { visibility: hidden !important }', path: `../screenshots/onboarding-funnel-${theme}-${device}.png`})
    await panel.getByRole('button', {name: 'Pause collection'}).click()
    await panel.getByRole('button', {name: 'Cancel', exact: true}).click()
    const report = await (await page.request.get('/api/admin/onboarding-funnel')).json()
    expect(report.totals.carryover).toBeGreaterThan(0)
    expect(JSON.stringify(report)).not.toContain(attempt.token)
    expect(report.collection_paused).toBe(false)
  })
}

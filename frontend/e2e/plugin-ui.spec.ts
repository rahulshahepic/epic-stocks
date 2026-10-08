import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { pluginHost, snapshots } from './plugin-host'

test('portfolio reads, filters, expansion and conversation context', async ({page}) => {
  const widget = await pluginHost(page)
  await expect(widget.getByText('$225,000')).toBeVisible()
  await widget.getByRole('button', {name:'Grants',exact:true}).click()
  await expect(widget.getByText('2023 · Purchase',{exact:true})).toBeVisible()
  await widget.getByRole('button', {name:'Loans',exact:true}).click()
  await expect(widget.getByText('refinanced',{exact:true})).toBeVisible()
  await widget.getByRole('button', {name:'Events',exact:true}).click()
  await expect(widget.getByText('Showing 1 of 2 events.',{exact:false})).toBeVisible()
  await widget.getByLabel('From',{exact:true}).fill('2027-01-01')
  await widget.getByLabel('Through',{exact:true}).fill('2027-12-31')
  await widget.getByRole('button', {name:'Apply',exact:true}).click()
  await widget.getByRole('button', {name:'Explain this',exact:true}).click()
  await widget.getByRole('button', {name:'Expand',exact:true}).click()
  await expect(widget.getByRole('button', {name:'Collapse',exact:true})).toBeVisible()
  const calls = await page.evaluate(() => (window as unknown as {pluginCalls: {method:string;params: Record<string,unknown>}[]}).pluginCalls)
  expect(calls.filter(c=>c.method==='tools/call').map(c=>c.params)).toContainEqual({name:'refresh_equity_view',arguments:{view:'events',account:'me',from_date:'2027-01-01',to_date:'2027-12-31'}})
  expect(calls.some(c=>c.method==='ui/message')).toBe(true)
})

test('missing prices and assumed prices remain explicit', async ({page}) => {
  const widget = await pluginHost(page, {initial:{...snapshots.summary,data:{...snapshots.summary.data,net_equity:null,total_stock_value:null}}})
  await expect(widget.getByText('Not available',{exact:true}).first()).toBeVisible()
  await expect(widget.getByText('No current valuation is available.',{exact:false})).toBeVisible()
  await page.evaluate(snapshot => window.frames[0].postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:snapshot}},'*'), {...snapshots.summary,data:{...snapshots.summary.data,price_is_estimate:true,projection_warning:'The price is an assumption, not a real valuation.'}})
  await expect(widget.getByText('Net equity · assumed price',{exact:true})).toBeVisible()
})

test('failed refresh keeps the snapshot and labels it stale', async ({page}) => {
  const widget = await pluginHost(page,{failure:true})
  await widget.getByRole('button',{name:'Refresh',exact:true}).click()
  await expect(widget.getByRole('status')).toContainText('The displayed data was not refreshed.')
  await expect(widget.getByText('$225,000')).toBeVisible()
  await expect(widget.getByRole('button',{name:'Refresh',exact:true})).toBeEnabled()
})

test('labels are rendered as text, including malicious grant names', async ({page}) => {
  const widget = await pluginHost(page,{initial:{...snapshots.grants,data:{grants:[{year:2023,type:'<img src=x onerror="alert(1)">',shares:100,periods:5,vest_start:'2024-03-01'}]}}})
  await expect(widget.getByText('<img src=x onerror="alert(1)">',{exact:false})).toBeVisible()
  expect(await widget.locator('img').count()).toBe(0)
})

for (const theme of ['light','dark'] as const) {
  test(`mobile layout and accessibility - ${theme}`, async ({page}) => {
    await page.setViewportSize({width:375,height:812})
    const widget = await pluginHost(page,{theme})
    for (const view of ['Overview','Grants','Loans','Events']) {
      await widget.getByRole('button',{name:view,exact:true}).click()
      await expect(widget.locator('#content')).toHaveAttribute('aria-busy','false')
      const frame = page.frames()[1]
      expect(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      const audit = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()
      expect(audit.violations).toEqual([])
    }
  })
}

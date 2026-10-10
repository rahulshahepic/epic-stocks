import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { pluginHost, snapshots, importReviewSnapshot } from './plugin-host'

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
  await expect(widget.getByText('Net equity · tentative price',{exact:true})).toBeVisible()
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
    for (const view of ['Overview','Grants','Loans','Events','Import']) {
      await widget.getByRole('button',{name:view,exact:true}).click()
      await expect(widget.locator('#content')).toHaveAttribute('aria-busy','false')
      const frame = page.frames()[1]
      expect(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      const audit = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()
      expect(audit.violations).toEqual([])
    }
  })
}

test('custom grant can be added, confirmed, reviewed and saved without a template', async ({page}) => {
  const widget = await pluginHost(page)
  await widget.getByRole('button',{name:'Import',exact:true}).click()
  await widget.getByRole('button',{name:'Add a new grant type',exact:true}).click()
  await widget.getByLabel('Grant name',{exact:true}).fill('Retention')
  await widget.getByLabel('Grant year',{exact:true}).fill('2025')
  await widget.getByLabel('Total shares',{exact:true}).fill('500')
  await widget.getByLabel('What you paid per share (0 = taxed at vest)',{exact:true}).fill('0')
  await widget.getByLabel('First vesting date',{exact:true}).fill('2026-03-01')
  await widget.getByLabel('Annual vesting periods',{exact:true}).fill('2')
  await widget.getByLabel('Exercise / purchase date',{exact:true}).fill('2025-12-31')
  await widget.getByLabel('I confirm these vesting dates, annual periods and exercise date').check()
  await widget.getByLabel('I confirm this cost basis, including whether it is zero').check()
  await widget.getByRole('button',{name:'Check changes',exact:true}).click()
  await expect(widget.getByRole('status')).toContainText('Checks complete.')
  await expect(widget.getByRole('button',{name:'Save confirmed import'})).toBeDisabled()
  await widget.getByLabel('I reviewed these changes, including any loans being removed, and want to save them').check()
  await expect(widget.getByRole('button',{name:'Save confirmed import'})).toBeEnabled()
  await widget.getByLabel('Annual vesting periods',{exact:true}).fill('3')
  await expect(widget.getByRole('button',{name:'Save confirmed import'})).toBeDisabled()
  await expect(widget.getByLabel('I confirm these vesting dates, annual periods and exercise date')).not.toBeChecked()
  await widget.getByLabel('I confirm these vesting dates, annual periods and exercise date').check()
  await widget.getByLabel('I confirm this cost basis, including whether it is zero').check()
  await widget.getByRole('button',{name:'Check changes',exact:true}).click()
  await expect(widget.getByRole('status')).toContainText('Checks complete.')
  await widget.getByLabel('I reviewed these changes, including any loans being removed, and want to save them').check()
  await widget.getByRole('button',{name:'Save confirmed import'}).click()
  await expect(widget.getByText('Import saved',{exact:true})).toBeVisible()
})

test('local and existing ChatGPT files use host references and parser roles', async ({page}) => {
  const widget = await pluginHost(page,{fileHelpers:true})
  await widget.getByRole('button',{name:'Import',exact:true}).click()
  await widget.getByLabel('PDFs, CSVs, Excel, JSON, letters or screenshots').setInputFiles({name:'summary.csv',mimeType:'text/csv',buffer:Buffer.from('synthetic')})
  await expect(widget.getByText('summary.csv',{exact:true})).toBeVisible()
  await widget.getByRole('button',{name:'Choose ChatGPT files'}).click()
  await expect(widget.getByText('letter.pdf',{exact:true})).toBeVisible()
  await widget.getByRole('button',{name:'Try parsing files'}).click()
  await expect(widget.getByLabel('Grant name',{exact:true})).toHaveValue('Retention')
  await widget.getByRole('button',{name:'Ask ChatGPT to help'}).click()
  await expect.poll(async()=>page.evaluate(()=>(window as unknown as {pluginCalls:{method:string}[]}).pluginCalls.some(c=>c.method==='ui/message'))).toBe(true)
  const calls=await page.evaluate(()=>(window as unknown as {pluginCalls:{method:string;params:Record<string,unknown>}[]}).pluginCalls)
  const parse=calls.find(c=>c.params.name==='analyze_import_files')
  expect(parse).toBeDefined()
  expect(JSON.stringify(parse)).toContain('share_csv')
  expect(JSON.stringify(parse)).toContain('evidence')
  expect(calls.some(c=>c.method==='ui/message' && JSON.stringify(c).includes('new grant type'))).toBe(true)
})

test('proposal-only connection cannot enable save', async ({page}) => {
  const widget=await pluginHost(page,{view:'import',savePermission:false,initial:{view:'import',data:{can_save:false,blocked:false,review_token:'not-authorized',payload:{grants:[],prices:[],sales:[]}}}})
  await widget.getByLabel('I reviewed these changes, including any loans being removed, and want to save them').check()
  await expect(widget.getByRole('button',{name:'Save confirmed import'})).toBeDisabled()
  await expect(widget.getByText('This connection cannot save equity.',{exact:false})).toBeVisible()
})

for(const theme of ['light','dark'] as const) {
  test(`custom grant review accessibility - ${theme}`,async({page})=>{
    await page.setViewportSize({width:375,height:812})
    const widget=await pluginHost(page,{theme,initial:importReviewSnapshot,fileHelpers:true})
    await expect(widget.getByLabel('Grant name',{exact:true})).toHaveValue('Retention Award')
    const frame=page.frames()[1]
    expect(await frame.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
    const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()
    expect(audit.violations).toEqual([])
  })
}


test('plugin import preserves tentative applicable and announcement dates', async ({page}) => {
  const widget = await pluginHost(page, {initial: {...importReviewSnapshot, data: {...importReviewSnapshot.data,
    payload: {...importReviewSnapshot.data.payload, prices: [{effective_date:'2027-01-01', price:110,
      is_estimate:true, expected_announcement_date:'2027-03-01', announced_date:null}]}}}})
  await expect(widget.getByLabel('Applicable price date', {exact:true})).toHaveValue('2027-01-01')
  await expect(widget.getByLabel('Tentative estimate', {exact:true})).toBeChecked()
  await expect(widget.getByLabel('Expected announcement date', {exact:true})).toHaveValue('2027-03-01')
  await widget.getByLabel('Tentative estimate', {exact:true}).uncheck()
  await widget.getByLabel('Actual announcement date (if known)', {exact:true}).fill('2027-02-27')
  await widget.getByRole('button', {name:'Check changes',exact:true}).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as {pluginCalls:{method:string;params:Record<string,unknown>}[]}).pluginCalls.some(c=>c.method==='tools/call' && c.params.name==='prepare_import_review'))).toBe(true)
  const calls = await page.evaluate(() => (window as unknown as {pluginCalls:{method:string;params:Record<string,unknown>}[]}).pluginCalls)
  const review = calls.find(c => c.method==='tools/call' && c.params.name==='prepare_import_review')
  expect(review?.params.arguments).toMatchObject({payload:{prices:[{effective_date:'2027-01-01', price:110,
    is_estimate:false, expected_announcement_date:'2027-03-01', announced_date:'2027-02-27'}]}})
})

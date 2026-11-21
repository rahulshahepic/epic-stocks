import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { retirementHost } from './plugin-host'

test('retirement card shows distinct shortfall and exhaustion risks', async ({page}) => {
  const card=await retirementHost(page)
  await expect(card.getByText('97.00%',{exact:true})).toBeVisible()
  await expect(card.getByText('3.00%',{exact:true})).toBeVisible()
  await expect(card.getByText('1.00%',{exact:true})).toBeVisible()
  await expect(card.getByText('$7.70M',{exact:true})).toBeVisible()
  await expect(card.getByRole('img',{name:'Median wealth and 10th to 90th percentile range by age'})).toBeVisible()
})

test('what-if runs do not save, and saving is explicit', async ({page}) => {
  const card=await retirementHost(page)
  await card.getByLabel('Annual spending ($K)').fill('220')
  await card.getByRole('button',{name:'Run simulation'}).click()
  await expect(card.getByRole('status')).toContainText('Changes are not saved')
  let calls=await page.evaluate(()=>(window as unknown as {pluginCalls:{method:string;params:{name?:string;arguments?:{overrides?:{defaultSpend?:number}}}}[]}).pluginCalls)
  expect(calls.some(c=>c.params.name==='refresh_retirement_view'&&c.params.arguments?.overrides?.defaultSpend===220)).toBe(true)
  expect(calls.some(c=>c.params.name==='update_retirement_params')).toBe(false)
  await card.getByRole('button',{name:'Save these inputs'}).click()
  await expect(card.getByRole('status')).toContainText('Saved to your Epic Stocks retirement plan')
  calls=await page.evaluate(()=>(window as unknown as {pluginCalls:{method:string;params:{name?:string;arguments?:{overrides?:{defaultSpend?:number}}}}[]}).pluginCalls)
  expect(calls.some(c=>c.params.name==='update_retirement_params')).toBe(true)
})

test('date comparison renders two scenarios without saving', async ({page}) => {
  const card=await retirementHost(page)
  await card.getByRole('button',{name:'Compare Oct 2031 / Jan 2032'}).click()
  await expect(card.getByRole('table')).toBeVisible()
  await expect(card.getByRole('cell',{name:'October 2031'})).toBeVisible()
  await expect(card.getByRole('cell',{name:'January 2032'})).toBeVisible()
  const calls=await page.evaluate(()=>(window as unknown as {pluginCalls:{method:string;params:{name?:string}}[]}).pluginCalls)
  expect(calls.some(c=>c.params.name==='compare_retirement_scenarios')).toBe(true)
  expect(calls.some(c=>c.params.name==='update_retirement_params')).toBe(false)
})

for(const theme of ['light','dark'] as const){
  test('retirement card mobile accessibility '+theme,async ({page})=>{
    await page.setViewportSize({width:375,height:812})
    const card=await retirementHost(page,theme)
    await expect(card.getByRole('button',{name:'Run simulation'})).toBeVisible()
    const frame=page.frames()[1]
    expect(await frame.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
    const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()
    expect(audit.violations).toEqual([])
  })
}

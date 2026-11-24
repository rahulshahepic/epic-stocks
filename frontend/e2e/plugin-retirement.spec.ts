import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { retirementHost, retirementSnapshot, purchaseSnapshot, mobileEditorSnapshot } from './plugin-host'

test('retirement card shows distinct shortfall and exhaustion risks', async ({page}) => {
  const card=await retirementHost(page)
  await expect(card.getByText('97.00%',{exact:true})).toBeVisible()
  await expect(card.getByText('3.00%',{exact:true})).toBeHidden()
  await card.getByText('Funding risk details', { exact: true }).click()
  await expect(card.getByText('3.00%',{exact:true})).toBeVisible()
  await expect(card.getByText('1.00%',{exact:true})).toBeVisible()
  await expect(card.getByText('$7.70M',{exact:true})).toBeVisible()
  await expect(card.getByRole('img',{name:'Median wealth and 10th to 90th percentile range by age'})).toBeVisible()
})

for (const theme of ['light', 'dark'] as const) {
  test('purchase charts stay visible outside the editor and update after running ' + theme, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const refreshed = { ...purchaseSnapshot, result: { ...purchaseSnapshot.result,
      purchaseSummary: { ...purchaseSnapshot.result.purchaseSummary, pathsWithPurchase: 700,
        purchaseProbability: 0.7, distribution: [{ purchases: 0, paths: 300, probability: 0.3 }, { purchases: 1, paths: 300, probability: 0.3 }, { purchases: 2, paths: 400, probability: 0.4 }] },
    } }
    const card = await retirementHost(page, theme, { initial: purchaseSnapshot, refreshed })
    const outcomes = card.getByRole('region', { name: 'Planned purchase outcomes' })
    await expect(card.locator('#lifeEventsDetails')).not.toHaveAttribute('open', '')
    await expect(outcomes.getByText('68.0%', { exact: true })).toBeVisible()
    await expect(outcomes.getByLabel('Sports car purchase probability', { exact: true })).toHaveAttribute('value', '0.5')
    await expect(outcomes.getByText('50.0% bought', { exact: true })).toBeVisible()
    await expect(outcomes.getByText(/Never bought:/).first()).toBeHidden()
    await expect(outcomes.getByText('Private college · 2044-08-01', { exact: true })).toBeVisible()
    await expect(outcomes.getByLabel('320 paths make 0 conditional purchases, 32.00%')).toBeVisible()
    await expect(card.locator('#plot')).toContainText('Portfolio ($M, retirement-year dollars)')
    await card.getByRole('button', { name: 'Edit plan assumptions', exact: true }).click()
    await card.getByRole('button', { name: 'Run simulation', exact: true }).click()
    await expect(outcomes.getByText('70.0%', { exact: true })).toBeVisible()
    await expect(outcomes.getByLabel('300 paths make 0 conditional purchases, 30.00%')).toBeVisible()
    expect(await page.frames()[1].evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(audit.violations).toEqual([])
  })
}

test('an unfunded plan does not show purchase odds', async ({ page }) => {
  const card = await retirementHost(page, 'light', { initial: purchaseSnapshot })
  await page.evaluate(initial => document.querySelector('iframe')?.contentWindow?.postMessage({
    jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: {
      ...initial, result: { ...initial.result, modelFeasible: false, preRetirementFundingGapM: 2 },
    } },
  }, '*'), purchaseSnapshot)
  await expect(card.locator('#purchaseResults')).toContainText('Fund the pre-retirement cash gap')
  await expect(card.locator('#purchaseSummary')).toBeEmpty()
  await expect(card.locator('#purchaseDistribution')).toBeEmpty()
})

test('what-if runs do not save, and saving is explicit', async ({page}) => {
  const card=await retirementHost(page)
  await card.getByRole('button', { name: 'Edit plan assumptions', exact: true }).click()
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
  await card.getByRole('button', { name: 'Compare dates', exact: true }).click()
  await card.getByLabel('Compare against').fill('2032-07-02')
  await card.getByRole('button',{name:'Compare retirement dates'}).click()
  await expect(card.getByRole('table')).toBeHidden()
  await card.getByText('Comparison details', { exact: true }).click()
  await expect(card.getByRole('table')).toBeVisible()
  await expect(card.getByRole('cell',{name:'2032-01-02'})).toBeVisible()
  await expect(card.getByRole('cell',{name:'2032-07-02'})).toBeVisible()
  const calls=await page.evaluate(()=>(window as unknown as {pluginCalls:{method:string;params:{name?:string;arguments?:{scenarios?:{overrides?:{retirementDate?:string};recalculate_exit?:boolean}[]}}}[]}).pluginCalls)
  const compare=calls.find(c=>c.params.name==='compare_retirement_scenarios')
  expect(compare?.params.arguments?.scenarios?.map(s=>s.overrides?.retirementDate)).toEqual(['2032-01-02','2032-07-02'])
  expect(compare?.params.arguments?.scenarios?.every(s=>s.recalculate_exit===true)).toBe(true)
  await expect(card.locator('#projectExit')).toBeChecked()
  await expect(card.locator('#compareProjectExit')).toBeChecked()
  await expect(card.locator('#comparison')).toContainText('date-specific projection')
  expect(calls.some(c=>c.params.name==='update_retirement_params')).toBe(false)
})

for(const theme of ['light','dark'] as const){
  test('retirement card mobile accessibility '+theme,async ({page})=>{
    await page.setViewportSize({width:375,height:812})
    const card=await retirementHost(page,theme)
    await expect(card.getByRole('button',{name:'Edit plan assumptions'})).toBeVisible()
    await expect(card.locator('#editView')).toBeHidden()
    const frame=page.frames()[1]
    expect(await frame.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
    const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()
    expect(audit.violations).toEqual([])
  })
}


test('life events in MCP card are read-only and passed to the planner', async ({page}) => {
  const card=await retirementHost(page)
  await card.getByRole('button', { name: 'Edit plan assumptions', exact: true }).click()
  await card.locator('#lifeEventsDetails > summary').click()
  await card.locator('#eventKind').selectOption('travel')
  await card.locator('#eventTitle').fill('Disney vacation')
  await card.locator('#eventDate').fill('2034-07-01')
  await card.locator('#eventBasis').selectOption('retirement')
  await card.locator('#eventAmount').fill('25000')
  await card.getByRole('button',{name:'Add planned event'}).click()
  await expect(card.getByText('Disney vacation', {exact:false})).toBeVisible()
  await card.getByRole('button',{name:'Compare impact with and without events'}).click()
  await expect(card.getByRole('status')).toContainText('No real sales or transactions created')
  const calls=await page.evaluate(()=>(window as unknown as {pluginCalls:{
    method:string;params:{name?:string;arguments?:{events?:{title:string;amountM:number}[]}}
  }[]}).pluginCalls)
  const plan=calls.find(c=>c.params.name==='plan_life_events')
  expect(plan?.params.arguments?.events?.[0].title).toBe('Disney vacation')
  expect(plan?.params.arguments?.events?.[0].amountM).toBe(0.025)
  expect(calls.some(c=>c.params.name==='update_retirement_params'||c.params.name==='apply_changes')).toBe(false)
})


test('MCP card with unfunded pre-retirement purchase hides misleading odds and wealth', async ({page}) => {
  const card = await retirementHost(page)
  await page.evaluate((initial) => {
    const frame = document.querySelector('iframe')
    frame?.contentWindow?.postMessage({
      jsonrpc: '2.0', method: 'ui/notifications/tool-result',
      params: { structuredContent: { ...initial, result: {
        ...initial.result, modelFeasible: false, preRetirementFundingGapM: 2,
      } } },
    }, '*')
  }, retirementSnapshot)
  await expect(card.getByRole('alert')).toContainText('Unfunded pre-retirement cash gap')
  await expect(card.locator('#success')).toHaveText('Not fundable')
  await expect(card.locator('#ending')).toHaveText('Not valid')
  await expect(card.locator('#chart')).toBeHidden()
})

test('MCP card converts a current sticker price without recording a sale', async ({page}) => {
  const card = await retirementHost(page)
  await card.getByRole('button', { name: 'Edit plan assumptions', exact: true }).click()
  await card.locator('#lifeEventsDetails > summary').click()
  await card.locator('#eventAmount').fill('100000')
  await card.locator('#eventAdvanced summary').click()
  await card.locator('#eventInflation').fill('0')
  await expect(card.getByRole('button', { name: 'Convert to retirement-year dollars' })).toHaveCount(0)
  await card.getByRole('button', { name: 'Add planned event', exact: true }).click()
  await expect(card.locator('#eventList')).toContainText('$100,000')
  const calls = await page.evaluate(() => (window as unknown as {pluginCalls:{
    params:{name?:string}
  }[]}).pluginCalls)
  expect(calls.some(c => c.params.name === 'update_retirement_params' || c.params.name === 'apply_changes')).toBe(false)
})

test('results open without a form; editing preserves chat parameters and returns to results', async ({ page }) => {
  const initial = { ...retirementSnapshot, inputOverrides: { ssMonthly: 3100, stockPct: 0.735, bondPct: 0.165 }, assumptions: { ...retirementSnapshot.assumptions,
    ssMonthly: 3100, stockPct: 0.735, bondPct: 0.165 } }
  const card = await retirementHost(page, 'light', { initial })
  await expect(card.locator('#resultsView')).toBeVisible()
  await expect(card.locator('#editView')).toBeHidden()
  await card.getByRole('button', { name: 'Edit plan assumptions' }).click()
  await card.getByLabel('Annual spending ($K)').fill('220')
  await card.getByRole('button', { name: 'Run simulation', exact: true }).click()
  await expect(card.locator('#editView')).toBeHidden()
  await expect(card.locator('#resultsView')).toBeVisible()
  const calls = await page.evaluate(() => (window as unknown as { pluginCalls: { params: {
    name?: string; arguments?: { overrides?: Record<string, unknown> }
  } }[] }).pluginCalls)
  expect(calls.find(c => c.params.name === 'refresh_retirement_view')?.params.arguments?.overrides)
    .toMatchObject({ defaultSpend: 220, ssMonthly: 3100, stockPct: 0.735, bondPct: 0.165 })
})

test('the expense comparison remains visible after leaving the editor', async ({ page }) => {
  const card = await retirementHost(page, 'light', { initial: purchaseSnapshot })
  await card.getByRole('button', { name: 'Edit plan assumptions' }).click()
  await card.locator('#lifeEventsDetails > summary').click()
  await card.getByRole('button', { name: 'Compare impact with and without events' }).click()
  await expect(card.locator('#editView')).toBeHidden()
  await expect(card.locator('#eventResults')).toBeVisible()
  await expect(card.locator('#eventResults')).toContainText('Without events')
})

test('waiting rules survive car editing, and changing type removes stale ownership fields', async ({ page }) => {
  const card = await retirementHost(page)
  await card.getByRole('button', { name: 'Edit plan assumptions' }).click()
  await card.locator('#lifeEventsDetails > summary').click()
  await card.locator('#eventKind').selectOption('vehicle')
  await card.locator('#eventBasis').selectOption('retirement')
  await card.locator('#eventAmount').fill('200000')
  await card.locator('#eventLifetime').fill('10')
  await expect(card.getByLabel('Depreciation schedule')).toBeVisible()
  await expect(card.locator('#eventDepreciation')).toBeHidden()
  await card.locator('#eventRule').selectOption('conditional')
  await card.locator('#eventMinRatio').pressSequentially('140')
  await expect(card.locator('#eventMinRatio')).toHaveValue('140')
  await card.locator('#eventFailure').selectOption('defer')
  await card.locator('#eventDeadline').fill('2040-01-01')
  await card.getByRole('button', { name: 'Add planned event', exact: true }).click()
  await card.locator('#eventList').getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(card.locator('#eventFailure')).toHaveValue('defer')
  await card.locator('#eventKind').selectOption('education')
  await card.getByRole('button', { name: 'Update event', exact: true }).click()
  await card.getByRole('button', { name: 'Compare impact with and without events' }).click()
  await expect(card.getByRole('status')).toContainText('Life-event comparison complete')
  const calls = await page.evaluate(() => (window as unknown as { pluginCalls: { params: {
    name?: string; arguments?: { events?: Record<string, unknown>[] }
  } }[] }).pluginCalls)
  const event = calls.find(c => c.params.name === 'plan_life_events')?.params.arguments?.events?.[0]
  expect(event).toMatchObject({ kind: 'education', conditionFailure: 'defer', deadlineDate: '2040-01-01', condition: { minStartingWealthRatio: 1.4 } })
  expect(event).not.toHaveProperty('lifetimeYears')
  expect(event).not.toHaveProperty('saleOffsetM')
})

test('editing saved tuition preserves four years when the start date moves', async ({ page }) => {
  const initial = { ...retirementSnapshot, assumptions: { ...retirementSnapshot.assumptions,
    plannedEvents: [{ id: 'college-duration', title: 'College', kind: 'education',
      date: '2044-08-01', amountM: 0, annualCostM: 0.1, durationYears: 4 }] } }
  const card = await retirementHost(page, 'light', { initial })
  await card.getByRole('button', { name: 'Edit plan assumptions' }).click()
  await card.locator('#lifeEventsDetails > summary').click()
  await card.locator('#eventList').getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(card.locator('#eventDuration')).toHaveValue('4')
  await card.locator('#eventDate').fill('2045-08-01')
  await card.getByRole('button', { name: 'Update event' }).click()
  await card.getByRole('button', { name: 'Compare impact with and without events' }).click()
  await expect(card.getByRole('status')).toContainText('Life-event comparison complete')
  const calls = await page.evaluate(() => (window as unknown as { pluginCalls: { params: {
    name?: string; arguments?: { events?: Record<string, unknown>[] }
  } }[] }).pluginCalls)
  expect(calls.find(c => c.params.name === 'plan_life_events')?.params.arguments?.events?.[0])
    .toMatchObject({ date: '2045-08-01', durationYears: 4 })
})

test('projected exits and derived defaults never become inputs when projection is switched off', async ({ page }) => {
  const projected = { ...retirementSnapshot, exitSource: 'projected_exit', inputOverrides: {},
    assumptions: { ...retirementSnapshot.assumptions, epicExit: 9, defaultSpend: 270, minSpend: 180,
      stateLTCGRate: 0.07, spouseCurrentAge: 45, spouseFra: 67 } }
  const restored = { ...retirementSnapshot, retirementDate: '2033-01-02', inputOverrides: { retirementDate: '2033-01-02' } }
  const card = await retirementHost(page, 'light', { refreshResponses: [projected, restored] })
  await card.getByRole('button', { name: 'Edit plan assumptions' }).click()
  await card.locator('#exitEstimateDetails > summary').click()
  await card.locator('#projectExit').check()
  await card.getByRole('button', { name: 'Run simulation', exact: true }).click()
  await expect(card.locator('#resultsView')).toBeVisible()
  await card.getByRole('button', { name: 'Edit plan assumptions' }).click()
  await expect(card.locator('#spend')).toHaveValue('270')
  await card.locator('#projectExit').uncheck()
  await card.getByRole('button', { name: 'Save these inputs' }).click()
  await expect(card.getByRole('status')).toContainText('No changed inputs to save')
  await card.locator('#date').fill('2033-01-02')
  await card.getByRole('button', { name: 'Run simulation', exact: true }).click()
  await expect(card.getByRole('status')).toContainText('Simulation complete')
  await card.getByRole('button', { name: 'Save these inputs' }).click()
  await expect(card.getByRole('status')).toContainText('Saved to your Epic Stocks retirement plan')
  const calls = await page.evaluate(() => (window as unknown as { pluginCalls: { params: {
    name?: string; arguments?: { overrides?: Record<string, unknown>; changes?: Record<string, unknown>; recalculate_exit?: boolean }
  } }[] }).pluginCalls)
  const runs = calls.filter(c => c.params.name === 'refresh_retirement_view')
  expect(runs[0].params.arguments?.overrides).toEqual({})
  expect(runs[1].params.arguments).toEqual({ account: 'me', overrides: { retirementDate: '2033-01-02' }, recalculate_exit: false })
  expect(calls.find(c => c.params.name === 'update_retirement_params')?.params.arguments?.changes)
    .toEqual({ retirementDate: '2033-01-02' })
})

test('saving a projected exit requires a completed projection for the selected date', async ({ page }) => {
  const projected = { ...retirementSnapshot, exitSource: 'projected_exit', inputOverrides: {},
    assumptions: { ...retirementSnapshot.assumptions, epicExit: 9 } }
  const card = await retirementHost(page, 'light', { refreshResponses: [projected] })
  await card.getByRole('button', { name: 'Edit plan assumptions' }).click()
  await card.locator('#exitEstimateDetails > summary').click()
  await card.locator('#projectExit').check()
  await card.getByLabel('Also save this Epic sale estimate as a fixed amount', { exact: true }).check()
  await card.getByRole('button', { name: 'Run simulation', exact: true }).click()
  await expect(card.locator('#resultsView')).toBeVisible()
  await card.getByRole('button', { name: 'Edit plan assumptions' }).click()
  await card.locator('#date').fill('2033-01-02')
  await card.getByRole('button', { name: 'Save these inputs' }).click()
  await expect(card.getByRole('status')).toContainText('Run simulation to update the Epic sale estimate for this date before saving')
  await card.locator('#date').fill('2032-01-02')
  await card.getByRole('button', { name: 'Save these inputs' }).click()
  await expect(card.getByRole('status')).toContainText('Saved to your Epic Stocks retirement plan')
  const calls = await page.evaluate(() => (window as unknown as { pluginCalls: { params: {
    name?: string; arguments?: { changes?: Record<string, unknown> }
  } }[] }).pluginCalls)
  const saves = calls.filter(c => c.params.name === 'update_retirement_params')
  expect(saves).toHaveLength(1)
  expect(saves[0].params.arguments?.changes).toMatchObject({ epicExit: 9 })
})

test('lowering spending does not send a resolved spending floor or other derived values', async ({ page }) => {
  const card = await retirementHost(page)
  await card.getByRole('button', { name: 'Edit plan assumptions' }).click()
  await card.locator('#spend').fill('50')
  await card.getByRole('button', { name: 'Run simulation', exact: true }).click()
  await expect(card.locator('#resultsView')).toBeVisible()
  await card.getByRole('button', { name: 'Save these inputs' }).click()
  await expect(card.getByRole('status')).toContainText('Saved to your Epic Stocks retirement plan')
  const calls = await page.evaluate(() => (window as unknown as { pluginCalls: { params: {
    name?: string; arguments?: { overrides?: Record<string, unknown>; changes?: Record<string, unknown> }
  } }[] }).pluginCalls)
  expect(calls.find(c => c.params.name === 'refresh_retirement_view')?.params.arguments?.overrides).toEqual({ defaultSpend: 50 })
  expect(calls.find(c => c.params.name === 'update_retirement_params')?.params.arguments?.changes).toEqual({ defaultSpend: 50 })
})

test('financing requires a supplied rate and permits an intentional zero rate', async ({ page }) => {
  const card = await retirementHost(page)
  await card.getByRole('button', { name: 'Edit plan assumptions' }).click()
  await card.locator('#lifeEventsDetails > summary').click()
  await card.locator('#eventKind').selectOption('vehicle')
  await card.locator('#eventAmount').fill('100000')
  await card.locator('#eventPayment').selectOption('finance')
  await expect(card.locator('#eventRate')).toHaveValue('')
  await card.getByRole('button', { name: 'Add planned event', exact: true }).click()
  await expect(card.getByRole('status')).toContainText('Enter the loan interest rate')
  await card.locator('#eventRate').fill('0')
  await card.getByRole('button', { name: 'Add planned event', exact: true }).click()
  await card.getByRole('button', { name: 'Compare impact with and without events' }).click()
  await expect(card.getByRole('status')).toContainText('Life-event comparison complete')
  const calls = await page.evaluate(() => (window as unknown as { pluginCalls: { params: {
    name?: string; arguments?: { events?: Record<string, unknown>[] }
  } }[] }).pluginCalls)
  expect(calls.find(c => c.params.name === 'plan_life_events')?.params.arguments?.events?.[0]).toMatchObject({ loanRate: 0, loanYears: 5 })
})

for (const initiallyProjected of [false, true]) {
  test(`fixed-exit comparison is explicit and independent of the single-run checkbox (${initiallyProjected})`, async ({ page }) => {
    const initial = { ...retirementSnapshot, exitSource: initiallyProjected ? 'projected_exit' : 'saved_exit',
      assumptions: { ...retirementSnapshot.assumptions, epicExit: initiallyProjected ? 9 : 6 } }
    const card = await retirementHost(page, 'light', { initial })
    await card.getByRole('button', { name: 'Compare dates', exact: true }).click()
    await expect(card.locator('#compareProjectExit')).toBeChecked()
    await card.getByRole('button', { name: 'Compare retirement dates', exact: true }).click()
    await expect(card.locator('#compare')).toBeVisible()
    await card.getByLabel('Project Epic exit separately for each date').uncheck()
    await expect(card.locator('#compare')).toBeHidden()
    await expect(card.locator('#compareExitBasis')).toContainText('saved Epic exit assumption')
    await card.getByRole('button', { name: 'Compare retirement dates', exact: true }).click()
    await expect(card.locator('#comparison')).toContainText('Epic exit $6.00M · fixed input')
    const calls = await page.evaluate(() => (window as unknown as { pluginCalls: { params: {
      name?: string; arguments?: { scenarios?: { recalculate_exit?: boolean; overrides?: Record<string, unknown> }[] }
    } }[] }).pluginCalls)
    const comparisons = calls.filter(c => c.params.name === 'compare_retirement_scenarios')
    expect(comparisons[0].params.arguments?.scenarios?.every(s => s.recalculate_exit === true)).toBe(true)
    expect(comparisons[1].params.arguments?.scenarios?.every(s => s.recalculate_exit === false)).toBe(true)
    expect(comparisons[1].params.arguments?.scenarios?.every(s => !('epicExit' in (s.overrides ?? {})))).toBe(true)
    expect(calls.some(c => c.params.name === 'update_retirement_params')).toBe(false)
    await expect(card.locator('#projectExit')).toBeChecked()
    await card.getByLabel('Compare against').fill('2033-01-02')
    await expect(card.locator('#compare')).toBeHidden()
  })
}

test('comparison permission errors stay visible without a silent fixed-exit fallback', async ({ page }) => {
  const card = await retirementHost(page, 'light', { comparisonFailure: 'Date-specific projections require equity:read permission.' })
  await card.getByRole('button', { name: 'Compare dates', exact: true }).click()
  await card.getByRole('button', { name: 'Compare retirement dates', exact: true }).click()
  await expect(card.locator('#compareError')).toContainText('equity:read')
  await expect(card.locator('#compare')).toBeHidden()
  await expect(card.locator('#compareProjectExit')).toBeChecked()
  const calls = await page.evaluate(() => (window as unknown as { pluginCalls: { params: { name?: string } }[] }).pluginCalls)
  expect(calls.filter(c => c.params.name === 'compare_retirement_scenarios')).toHaveLength(1)
})

test('car presets roundtrip through the connector and replace at the sale interval', async ({ page }) => {
  const card = await retirementHost(page)
  await card.getByRole('button', { name: 'Edit plan assumptions', exact: true }).click()
  await card.locator('#lifeEventsDetails > summary').click()
  await card.locator('#eventKind').selectOption('vehicle')
  await card.locator('#eventDate').fill('2035-01-01')
  await card.locator('#eventAmount').fill('50000')
  await card.locator('#eventBasis').selectOption('retirement')
  await card.getByLabel('Depreciation schedule').selectOption('strong')
  await card.getByLabel('Replace when sold', { exact: true }).check()
  await card.getByLabel('Sell car after N years (optional)').fill('12')
  await card.getByRole('button', { name: 'Add planned event', exact: true }).click()
  await card.getByRole('button', { name: 'Compare impact with and without events', exact: true }).click()
  await expect(card.getByRole('status')).toContainText('Life-event comparison complete')
  const calls = await page.evaluate(() => (window as unknown as { pluginCalls: Array<{ params: { name: string; arguments: { events: unknown[] } } }> }).pluginCalls)
  expect(calls.find(c => c.params.name === 'plan_life_events')?.params.arguments.events[0]).toMatchObject({
    lifetimeYears: 12, replacementEveryYears: 12, depreciationProfile: 'strong', vehicleAgeYears: 0, amountM: .05,
  })
})


test('purchase details explain the different funded measure without repeating the headline', async ({ page }) => {
  const card = await retirementHost(page, 'dark', { initial: purchaseSnapshot })
  const outcomes = card.getByRole('region', { name: 'Planned purchase outcomes' })
  await expect(outcomes.getByText('68.0%', { exact: true })).toHaveCount(1)
  await expect(outcomes.getByText(/680 of 1,000 simulations/)).toBeHidden()
  await expect(outcomes.getByText(/Buy \+ fully fund retirement: 65.00%/)).toBeHidden()
  await expect(outcomes.getByRole('img', { name: 'Sports car first purchase timing', exact: true })).toBeVisible()
  await outcomes.getByText('Calculation details', { exact: true }).click()
  await expect(outcomes.getByText(/680 of 1,000 simulations/)).toBeVisible()
  await expect(outcomes.getByText(/Buy \+ fully fund retirement: 65.00%/)).toBeVisible()
  await outcomes.getByLabel('Details for Sports car', { exact: true }).click()
  await expect(outcomes.getByText('Never bought: 50.00%', { exact: true })).toBeVisible()
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(audit.violations).toEqual([])
})


test('required-only plans show scheduled expenses without an optional-purchase headline', async ({ page }) => {
  const initial = { ...purchaseSnapshot, assumptions: { ...purchaseSnapshot.assumptions,
    plannedEvents: purchaseSnapshot.assumptions.plannedEvents.filter(e => e.kind === 'education') },
  result: { ...purchaseSnapshot.result, eventOutcomes: [], purchaseSummary: { ...purchaseSnapshot.result.purchaseSummary,
    purchaseProbability: 0, fundedPurchaseProbability: 0, pathsWithPurchase: 0, distribution: [{ purchases: 0, paths: 1000, probability: 1 }] } } }
  const card = await retirementHost(page, 'light', { initial })
  await expect(card.locator('#purchaseSummary')).toBeEmpty()
  await expect(card.locator('#purchaseDistribution')).toBeHidden()
  await expect(card.getByText('Scheduled in every simulation', { exact: true })).toBeVisible()
  await expect(card.getByText('Private college · 2044-08-01', { exact: true })).toBeVisible()
})

for (const width of [320, 375, 390]) {
  test(`retirement editor keeps mobile labels and event actions contained at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 })
    const card = await retirementHost(page, 'dark', { initial: mobileEditorSnapshot })
    await card.getByRole('button', { name: 'Edit plan assumptions', exact: true }).click()
    await card.locator('#lifeEventsDetails > summary').click()
    const frame = page.frames()[1]
    const layout = await frame.evaluate(() => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(el => el.getClientRects().length)
      return {
        pageFits: document.documentElement.scrollWidth <= innerWidth,
        fieldsFit: [...document.querySelectorAll<HTMLElement>('input,select')].filter(el => el.getClientRects().length).every(el => el.getBoundingClientRect().right <= el.parentElement!.getBoundingClientRect().right + 1),
        buttonsFit: buttons.every(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth),
        actionsBelowText: [...document.querySelectorAll('.event-card')].every(el => {
          const text = el.querySelector('.event-facts')!.getBoundingClientRect()
          const actions = el.querySelector('.event-actions')!.getBoundingClientRect()
          return actions.top >= text.bottom + 10
        }),
      }
    })
    expect(layout).toEqual({ pageFits: true, fieldsFit: true, buttonsFit: true, actionsBelowText: true })
    const home = card.getByRole('article').filter({ has: card.getByRole('heading', { name: 'Future home with space for visiting family' }) })
    await home.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(card.getByLabel('Name', { exact: true })).toHaveValue('Future home with space for visiting family')
    await card.getByRole('button', { name: 'Update event', exact: true }).click()
    await home.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(home).toHaveCount(0)
    await expect(card.getByRole('article')).toHaveCount(2)
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(audit.violations).toEqual([])
  })
}

test('date-based Epic sale estimate is the default while explicit amounts stay fixed', async ({ page }) => {
  const card = await retirementHost(page)
  await card.getByRole('button', { name: 'Edit plan assumptions' }).click()
  await expect(card.locator('#projectExit')).toBeChecked()
  await expect(card.locator('#exitModeSummary')).toContainText('estimated for your retirement date')
  await card.locator('#date').fill('2033-01-02')
  await card.getByRole('button', { name: 'Run simulation', exact: true }).click()
  await expect(card.locator('#resultsView')).toBeVisible()
  const calls = await page.evaluate(() => (window as unknown as { pluginCalls: { params: { name?: string; arguments?: { recalculate_exit?: boolean } } }[] }).pluginCalls)
  expect(calls.find(c => c.params.name === 'refresh_retirement_view')?.params.arguments?.recalculate_exit).toBe(true)
  const fixed = await retirementHost(page, 'light', { initial: { ...retirementSnapshot, inputOverrides: { epicExit: 6 } } })
  await fixed.getByRole('button', { name: 'Edit plan assumptions' }).click()
  await expect(fixed.locator('#projectExit')).not.toBeChecked()
  await expect(fixed.locator('#exitModeSummary')).toContainText('fixed Epic sale amount')
})

test('saving ordinary inputs does not require or save an Epic sale projection', async ({ page }) => {
  const card = await retirementHost(page)
  await card.getByRole('button', { name: 'Edit plan assumptions' }).click()
  await card.locator('#spend').fill('200')
  await card.getByRole('button', { name: 'Save these inputs' }).click()
  await expect(card.getByRole('status')).toContainText('Saved to your Epic Stocks retirement plan')
  const calls = await page.evaluate(() => (window as unknown as { pluginCalls: { params: { name?: string; arguments?: { changes?: Record<string, unknown> } } }[] }).pluginCalls)
  expect(calls.some(c => c.params.name === 'refresh_retirement_view')).toBe(false)
  expect(calls.find(c => c.params.name === 'update_retirement_params')?.params.arguments?.changes).toEqual({ defaultSpend: 200 })
  await card.locator('#exitEstimateDetails > summary').click()
  await expect(card.locator('#saveExit')).not.toBeChecked()
  await card.locator('#saveExit').check()
  await card.locator('#projectExit').uncheck()
  await expect(card.locator('#saveExit')).not.toBeChecked()
})

test('connections without stock-data access run and compare with their saved Epic amount', async ({ page }) => {
  const card = await retirementHost(page, 'light', { initial: { ...mobileEditorSnapshot, canProjectExit: false } })
  await card.getByRole('button', { name: 'Edit plan assumptions' }).click()
  await expect(card.locator('#exitModeSummary')).toContainText('Stock-data access is needed')
  await expect(card.locator('#projectExit')).not.toBeChecked()
  await expect(card.locator('#projectExit')).toBeDisabled()
  await card.getByRole('button', { name: 'Run simulation', exact: true }).click()
  await expect(card.locator('#resultsView')).toBeVisible()
  await card.getByRole('button', { name: 'Edit plan assumptions' }).click()
  await card.locator('#lifeEventsDetails > summary').click()
  await card.getByRole('button', { name: 'Compare impact with and without events', exact: true }).click()
  await expect(card.getByRole('status')).toContainText('Life-event comparison complete')
  await card.getByRole('button', { name: 'Compare dates', exact: true }).click()
  await expect(card.locator('#compareProjectExit')).not.toBeChecked()
  await expect(card.locator('#compareProjectExit')).toBeDisabled()
  await card.getByRole('button', { name: 'Compare retirement dates', exact: true }).click()
  await expect(card.getByRole('status')).toContainText('Comparison complete')
  const calls = await page.evaluate(() => (window as unknown as { pluginCalls: { params: { name?: string; arguments?: { recalculate_exit?: boolean; scenarios?: { recalculate_exit?: boolean }[] } } }[] }).pluginCalls)
  for (const name of ['refresh_retirement_view', 'plan_life_events']) expect(calls.find(c => c.params.name === name)?.params.arguments?.recalculate_exit).toBe(false)
  expect(calls.find(c => c.params.name === 'compare_retirement_scenarios')?.params.arguments?.scenarios?.every(s => s.recalculate_exit === false)).toBe(true)
})

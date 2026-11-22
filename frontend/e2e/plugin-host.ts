/** Host harness for the actual MCP resource. All figures are synthetic. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
const html = readFileSync(fileURLToPath(new URL('../../backend/app/mcp/portfolio.html', import.meta.url)), 'utf8')
export const snapshots = {
  summary: { view: 'summary', account: 'me', as_of: '2026-10-08', data: {
    net_equity: 225000, total_stock_value: 300000, outstanding_loan_balance: 70000,
    held_vested_shares: 20000, accrued_unbooked_interest: 5000, price_is_estimate: false,
    next_event: { date: '2027-03-01', event_type: 'Vesting' },
  } },
  grants: { view: 'grants', account: 'me', as_of: '2026-10-08', data: {
    grants: [{year: 2023, type: 'Purchase', shares: 10000, periods: 5, vest_start: '2024-03-01'}],
  } },
  loans: { view: 'loans', account: 'me', as_of: '2026-10-08', data: {
    total_outstanding: 70000, loans: [
      {grant_year: 2023, loan_type: 'Purchase', balance: 70000, interest_rate: 0.03, due_date: '2030-12-31', status: 'outstanding'},
      {grant_year: 2021, loan_type: 'Purchase', balance: 0, interest_rate: 0.04, due_date: '2028-12-31', status: 'refinanced'},
    ],
  } },
  import: { view: 'import', data: {can_save:true,blocked:true,payload:{grants:[],prices:[],sales:[]},files:[],findings:[]} },
  events: { view: 'events', account: 'me', as_of: '2026-10-08', data: {
    events: [{ date: '2027-03-01', event_type: 'Vesting', grant_year: 2023, grant_type: 'Purchase', vested_shares: 2000, valuation_is_projected: true }],
    returned: 1, matched: 2, truncated: true, projection_warning: 'Future monetary values are projections. Scheduled dates and share counts are known.',
  } },
}
export const importReviewSnapshot = {view:'import',data:{can_save:true,blocked:false,revision:'synthetic-review',review_token:'synthetic-token',files:[],payload:{grants:[{year:2025,type:'Retention Award',shares:500,price:0,vest_start:'2026-03-01',periods:2,exercise_date:'2025-12-31',dp_shares:0,custom_schedule:true,schedule_confirmed:true,basis_confirmed:true,loans:[]}],prices:[],sales:[]},summary:{grants:1,loans:0,prices:0,sales:0},changes:{grants_added:['2025 Retention Award: 500 shares'],grants_kept:['2023 Purchase']},findings:[]}}
export async function pluginHost(page: Page, options: { view?: keyof typeof snapshots; theme?: 'light' | 'dark'; initial?: object; failure?: boolean; importFailure?: boolean; fileHelpers?: boolean; savePermission?: boolean } = {}) {
  await page.goto('/login')
  const initial = options.initial ?? snapshots[options.view ?? 'summary']
  await page.evaluate(({html, snapshots, initial, options}) => {
    document.body.innerHTML = ''
    const frame = document.createElement('iframe')
    frame.title = 'Epic Stocks plugin'
    frame.style.cssText = 'width:100%;border:0;height:900px;display:block'
    document.body.style.cssText = 'margin:0;background:'+(options.theme === 'dark' ? '#25221f' : '#fffdf9')
    const calls: {method: string; params: Record<string, unknown>}[] = []
    Object.assign(window, { pluginCalls: calls })
    window.addEventListener('message', event => {
      if (event.source !== frame.contentWindow) return
      const msg = event.data
      if (msg.method) calls.push({method: msg.method, params: msg.params})
      const reply = (result: unknown) => frame.contentWindow?.postMessage({jsonrpc:'2.0',id:msg.id,result},'*')
      if (msg.method === 'ui/initialize') reply({hostContext:{theme:options.theme ?? 'light',displayMode:'inline',availableDisplayModes:['inline','fullscreen']}})
      if (msg.method === 'ui/notifications/initialized') frame.contentWindow?.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:initial}},'*')
      if (msg.method === 'tools/call') {
        if (options.failure) reply({isError:true,content:[{type:'text',text:'This connection has been disconnected.'}]})
        else if(msg.params.name === 'show_import') reply({structuredContent:{...snapshots.import,data:{...snapshots.import.data,can_save:options.savePermission !== false}}})
        else if(msg.params.name === 'analyze_import_files') reply({structuredContent:{view:'import',data:{can_save:true,blocked:true,revision:'parsed',files:msg.params.arguments.files,payload:{grants:[{year:2025,type:'Retention',shares:500,price:0,vest_start:'2026-03-01',periods:2,exercise_date:'2025-12-31',dp_shares:0,custom_schedule:true,schedule_confirmed:false,basis_confirmed:false,loans:[]}],prices:[],sales:[]},findings:[{message:'Confirm the custom grant schedule and cost basis.'}]}}})
        else if(msg.params.name === 'prepare_import_review') {
          const payload=msg.params.arguments.payload
          const blocked=options.importFailure || payload.grants.some((g: {custom_schedule?:boolean;schedule_confirmed?:boolean;basis_confirmed?:boolean})=>g.custom_schedule && (!g.schedule_confirmed || !g.basis_confirmed))
          reply({structuredContent:{view:'import',data:{payload,can_save:options.savePermission !== false,blocked,revision:'reviewed',review_token:blocked ? undefined : 'review-token',summary:{grants:payload.grants.length,loans:0,prices:payload.prices.length,sales:payload.sales.length},changes:{grants_added:['2025 Retention: 500 shares'],grants_kept:['2023 Purchase']},findings:blocked ? [{message:'Confirm the custom grant schedule and cost basis.'}] : []}}})
        } else if(msg.params.name === 'accept_import_review') reply({structuredContent:{view:'import',data:{saved:true,summary:{grants:1,loans:0,prices:0,sales:0}}}})
        else reply({structuredContent:snapshots[msg.params.arguments.view as keyof typeof snapshots]})
      }
      if (msg.method === 'ui/message') reply({})
      if (msg.method === 'ui/request-display-mode') reply({mode:msg.params.mode})
      if (msg.method === 'ui/notifications/size-changed') frame.style.height=msg.params.height+'px'
    })
    if(options.fileHelpers) {
      const helpers = `<script>window.openai={uploadFile:async f=>({fileId:'file-local'}),selectFiles:async()=>[{fileId:'file-library',fileName:'letter.pdf',mimeType:'application/pdf'}],getFileDownloadUrl:async()=>({downloadUrl:'https://files.oaiusercontent.com/synthetic'})};</script>`
      frame.srcdoc = html.replace('<script>',helpers+'<script>')
    } else frame.srcdoc = html
    document.body.append(frame)
  }, {html, snapshots, initial, options})
  const widget = page.frameLocator('iframe')
  await widget.getByRole('button', {name:'Refresh', exact:true}).waitFor()
  return widget
}

const retirementHtml = readFileSync(fileURLToPath(new URL('../../backend/app/mcp/retirement.html', import.meta.url)), 'utf8')
export const retirementSnapshot = {
  retirementDate:'2032-01-02',exitSource:'saved_exit',saved:false,
  assumptions:{epicExit:6,taxableAdditional:1,traditional:.5,roth:.2,defaultSpend:180,minSpend:100,healthInsurance:25,stockPct:.7,bondPct:.2,scenario:'cautious',currentAge:48,endAge:91,paths:1000,seed:1729},
  result:{paths:1000,startingTotalM:7.7,pctFundingShortfall:.03,pctExhausted:.01,medianFinalM:12.4,
    wealthByAge:[{age:48,p10:7.7,p50:7.7,p90:7.7},{age:68,p10:4,p50:10,p90:20},{age:91,p10:2,p50:12.4,p90:40}]},
}

export const purchaseSnapshot = {
  ...retirementSnapshot,
  assumptions: { ...retirementSnapshot.assumptions, plannedEvents: [
    { id: 'car', title: 'Sports car', kind: 'vehicle', date: '2035-01-02', amountM: 0.2, condition: { minStartingWealthRatio: 1.1 } },
    { id: 'replacement', title: 'Replacement sports car', kind: 'vehicle', date: '2045-01-02', amountM: 0.2, condition: { minStartingWealthRatio: 1.1 } },
    { id: 'college', title: 'Private college', kind: 'education', date: '2044-08-01', amountM: 0.1 },
  ] },
  result: { ...retirementSnapshot.result,
    eventOutcomes: [
      { eventId: 'car', title: 'Sports car', purchaseProbability: 0.5, skippedProbability: 0.5, meanPurchases: 0.5 },
      { eventId: 'replacement', title: 'Replacement sports car', purchaseProbability: 0.58, skippedProbability: 0.42, meanPurchases: 0.58 },
    ],
    purchaseSummary: { paths: 1000, pathsWithPurchase: 680, purchaseProbability: 0.68, meanPurchases: 1.08,
      distribution: [{ purchases: 0, paths: 320, probability: 0.32 }, { purchases: 1, paths: 280, probability: 0.28 }, { purchases: 2, paths: 400, probability: 0.4 }] },
  },
}

export async function retirementHost(page: Page, theme: 'light' | 'dark' = 'light', options: { initial?: object; refreshed?: object } = {}) {
  await page.goto('/login')
  await page.evaluate(({html,initial,theme,refreshed}) => {
    document.body.innerHTML=''
    const frame=document.createElement('iframe')
    frame.title='Epic Stocks retirement plugin'
    frame.style.cssText='width:100%;height:1000px;border:0;display:block'
    document.body.style.margin='0'
    const calls: {method:string;params:Record<string,unknown>}[]=[]
    Object.assign(window,{pluginCalls:calls})
    window.addEventListener('message',event=>{
      if(event.source!==frame.contentWindow)return
      const msg=event.data
      if(msg.method)calls.push({method:msg.method,params:msg.params})
      const reply=(result:unknown)=>frame.contentWindow?.postMessage({jsonrpc:'2.0',id:msg.id,result},'*')
      if(msg.method==='ui/initialize')reply({hostContext:{theme,displayMode:'inline',availableDisplayModes:['inline','fullscreen']}})
      if(msg.method==='ui/notifications/initialized')frame.contentWindow?.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:initial}},'*')
      if(msg.method==='tools/call'){
        if(msg.params.name==='compare_retirement_scenarios'){const args=msg.params.arguments as {scenarios:{name:string;overrides:{retirementDate:string}}[]};reply({structuredContent:{scenarios:args.scenarios.map(s=>({...initial,...s,retirementDate:s.overrides.retirementDate}))}})}
        else if(msg.params.name==='plan_life_events')reply({structuredContent:{baseline:initial,withEvents:{...initial,result:{...initial.result,pctFundingShortfall:.04,medianFinalM:11.8,p10FinalM:2.1}},hypotheticalEpicSales:[],saved:false}})
        else if(msg.params.name==='update_retirement_params')reply({structuredContent:{updated:['defaultSpend'],saved:true}})
        else reply({structuredContent:refreshed ?? initial})
      }
      if(msg.method==='ui/request-display-mode')reply({mode:msg.params.mode})
      if(msg.method==='ui/notifications/size-changed')frame.style.height=msg.params.height+'px'
    })
    frame.srcdoc=html
    document.body.append(frame)
  },{html:retirementHtml,initial:options.initial ?? retirementSnapshot,theme,refreshed:options.refreshed})
  const widget=page.frameLocator('iframe')
  await widget.getByText('97.00%',{exact:true}).waitFor()
  return widget
}

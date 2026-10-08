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
  events: { view: 'events', account: 'me', as_of: '2026-10-08', data: {
    events: [{ date: '2027-03-01', event_type: 'Vesting', grant_year: 2023, grant_type: 'Purchase', vested_shares: 2000, valuation_is_projected: true }],
    returned: 1, matched: 2, truncated: true, projection_warning: 'Future monetary values are projections. Scheduled dates and share counts are known.',
  } },
}
export async function pluginHost(page: Page, options: { view?: keyof typeof snapshots; theme?: 'light' | 'dark'; initial?: object; failure?: boolean } = {}) {
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
        else reply({structuredContent:snapshots[msg.params.arguments.view as keyof typeof snapshots]})
      }
      if (msg.method === 'ui/message') reply({})
      if (msg.method === 'ui/request-display-mode') reply({mode:msg.params.mode})
      if (msg.method === 'ui/notifications/size-changed') frame.style.height=msg.params.height+'px'
    })
    frame.srcdoc = html
    document.body.append(frame)
  }, {html, snapshots, initial, options})
  const widget = page.frameLocator('iframe')
  await widget.getByRole('button', {name:'Refresh', exact:true}).waitFor()
  return widget
}

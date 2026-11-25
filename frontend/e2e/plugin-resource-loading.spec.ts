const REVIEW_TEST_BACKEND = process.env.VITE_BACKEND_ORIGIN ?? 'http://localhost:8000'
import { createHash } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './helpers'
import { comparisonSnapshot, retirementHost } from './plugin-host'

const API = process.env.E2E_API_URL ?? `${REVIEW_TEST_BACKEND}`

async function connect(page: Page) {
  await loginAs(page, `resource-loader-${Date.now()}@example.com`)
  const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect'
  const verifier = 'a'.repeat(64)
  const registration = await page.request.post(`${API}/oauth/register`, { data: {
    client_name: 'ChatGPT', redirect_uris: [redirect], token_endpoint_auth_method: 'none',
  } })
  expect(registration.status()).toBe(201)
  const { client_id } = await registration.json()
  const query = new URLSearchParams({ response_type: 'code', client_id,
    redirect_uri: redirect, scope: 'comp:read', code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url') })
  const authorization = await page.request.get(`${API}/oauth/authorize?${query}`)
  expect(authorization.ok()).toBeTruthy()
  const html = await authorization.text()
  const action = html.match(/<form method="post" action="([^"]+)"/)?.[1]
  const request = html.match(/name="request" value="([^"]+)"/)?.[1]
  const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1]
  expect(action).toBeTruthy()
  expect(request).toBeTruthy()
  expect(csrf).toBeTruthy()
  const consent = await page.request.post(new URL(action!, API).href, {
    form: { request: request!, csrf: csrf!, decision: 'allow' }, maxRedirects: 0,
  })
  expect(consent.status()).toBe(302)
  const code = new URL(consent.headers().location).searchParams.get('code')
  expect(code).toBeTruthy()
  const exchange = await page.request.post(`${API}/oauth/token`, { form: {
    grant_type: 'authorization_code', code: code!, redirect_uri: redirect,
    client_id, code_verifier: verifier,
  } })
  expect(exchange.ok()).toBeTruthy()
  const tokens = await exchange.json()
  return { Authorization: `Bearer ${tokens.access_token}` }
}

async function retirementRpc(page: Page) {
  const headers = await connect(page)
  let id = 0
  return async (method: string, params = {}) => {
    const response = await page.request.post(`${API}/mcp`, {
      headers, data: { jsonrpc: '2.0', id: ++id, method, params },
    })
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    expect(body.error).toBeUndefined()
    return body.result
  }
}

test('cached retirement metadata loads through authenticated MCP resource reads', async ({ page }) => {
  const rpc = await retirementRpc(page)
  const { tools } = await rpc('tools/list')
  const currentUri = tools.find((tool: { name: string }) => tool.name === 'show_retirement')._meta.ui.resourceUri
  // A client can keep its old descriptor after the server advertises a new one.
  for (const uri of ['ui://epic-stocks/retirement-v3.html', currentUri]) {
    const { contents } = await rpc('resources/read', { uri })
    expect(contents[0].uri).toBe(uri)
    expect(contents[0].mimeType).toBe('text/html;profile=mcp-app')
    const card = await retirementHost(page, 'light', { resourceHtml: contents[0].text })
    await expect(card.locator('#resultsView')).toBeVisible()
    await card.getByRole('button', { name: 'Compare dates', exact: true }).click()
    await expect(card.getByLabel('Project Epic exit separately for each date')).toBeChecked()
  }
})

test('a host opens the scoped comparison resource with side-by-side metrics', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const rpc = await retirementRpc(page)
  const { tools } = await rpc('tools/list')
  const compare = tools.find((tool: { name: string }) => tool.name === 'compare_retirement_scenarios')
  expect(compare.outputSchema.properties.scenarios.maxItems).toBe(3)
  const uri = compare._meta.ui.resourceUri
  const { contents } = await rpc('resources/read', { uri })
  expect(contents[0].uri).toBe(uri)
  const card = await retirementHost(page, 'dark', {
    resourceHtml: contents[0].text, initial: {
      ...comparisonSnapshot,
      account_context: { synthetic: true, scenario: 'established employee', fixture_version: 1 },
    }, readyText: 'Retirement comparison',
  })
  const overview = card.getByRole('table', { name: 'Retirement scenario metrics' })
  await expect(overview.getByRole('columnheader', { name: 'Work one more year' })).toBeVisible()
  await expect(overview.getByRole('row', { name: /Retirement date/ })).toContainText('2033-01-02')
  await expect(overview.getByRole('row', { name: /Epic payout/ })).toContainText('After tax and loans')
  await expect(overview.getByRole('row', { name: /Epic payout/ })).toContainText('Fixed input')
  await expect(overview.getByRole('row', { name: /Starting assets/ })).toContainText('$8.70M')
  await expect(overview.getByRole('row', { name: /Any funding shortfall/ })).toContainText('1.8%')
  await expect(overview.getByRole('row', { name: /Portfolio exhaustion/ })).toContainText('Unavailable')
  await expect(card.getByText(/Fictional test account/)).toBeVisible()
  await expect(card.getByText(/pre-retirement funding gap of/)).toContainText('$0.45M')
  const distribution = card.getByRole('table', { name: 'Ending wealth by percentile' })
  await expect(distribution).toBeHidden()
  await card.getByText('All ending wealth percentiles').click()
  await expect(distribution.getByRole('row', { name: /^95%/ })).toContainText('$46.00M')
  const frame = page.frames()[1]
  expect(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

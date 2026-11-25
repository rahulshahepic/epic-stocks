const REVIEW_TEST_BACKEND = process.env.VITE_BACKEND_ORIGIN ?? 'http://localhost:8000'
import { createHash } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './helpers'
import { retirementHost } from './plugin-host'

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

test('cached retirement metadata loads through authenticated MCP resource reads', async ({ page }) => {
  const headers = await connect(page)
  let id = 0
  const rpc = async (method: string, params = {}) => {
    const response = await page.request.post(`${API}/mcp`, {
      headers, data: { jsonrpc: '2.0', id: ++id, method, params },
    })
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.error).toBeUndefined()
    return body.result
  }
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

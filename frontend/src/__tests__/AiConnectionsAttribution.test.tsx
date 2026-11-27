import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AiConnections } from '../scaffold/pages/admin/AiConnections.tsx'
import { api, type McpActionRequest } from '../api.ts'

const BASE: McpActionRequest = {
  id: 7,
  action: 'enable_redirect_rule',
  description: 'Switch a redirect rule back on',
  reason: null,
  status: 'pending',
  client_name: 'ChatGPT diagnostics',
  outcome: null,
  decided_by: null,
  requested_at: '2026-11-27T18:00:00Z',
  decided_at: null,
  filed_by_client: 'ChatGPT diagnostics',
  filed_by_account: 'admin@example.com',
  filed_connection_active: true,
}

function settingsWith(request: McpActionRequest) {
  return {
    enabled: true, connections: 1, hosts: [], rejected: [],
    requests: [request], request_history: [],
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'adminGetMcpUsage').mockResolvedValue({
    users: [], tools: [], calls_24h: 0, calls_7d: 0, calls_30d: 0,
    errors_7d: 0, denied_7d: 0, audit_rows: 0,
  })
})

describe('AiConnections requester attribution (#826)', () => {
  it('shows the server-recorded connection and the authorizing account', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue(settingsWith(BASE))
    render(<AiConnections onError={() => {}} />)
    const text = await screen.findByText(/server-recorded as/)
    expect(text.textContent).toContain('ChatGPT diagnostics')
    expect(text.textContent).toContain('admin@example.com')
    // The name's provenance is stated, not presented as verified identity.
    expect(text.textContent).toContain('recorded when the connection was authorized')
  })

  it('labels a differing claimed name as unverified', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue(settingsWith({
      ...BASE, client_name: 'Definitely The Real Claude', filed_by_client: 'Unknown app',
    }))
    render(<AiConnections onError={() => {}} />)
    const text = await screen.findByText(/claims the name/)
    expect(text.textContent).toContain('Definitely The Real Claude')
    expect(text.textContent).toContain('unverified')
  })

  it('says so when the filing connection is no longer active', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue(settingsWith({
      ...BASE, filed_by_client: null, filed_by_account: null, filed_connection_active: false,
    }))
    render(<AiConnections onError={() => {}} />)
    expect(await screen.findByText(/no longer active/)).toBeTruthy()
  })
})

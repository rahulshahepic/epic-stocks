import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiConnections } from '../scaffold/pages/admin/AiConnections.tsx'
import { api, type McpRejectedRedirect } from '../api.ts'

const SETTINGS = {
  enabled: true,
  connections: 2,
  hosts: [
    { id: 1, label: 'ChatGPT', pattern: 'https://chatgpt.com/connector_platform_oauth_redirect', match_type: 'exact' as const, enabled: true },
    { id: 2, label: 'Claude', pattern: 'https://claude.ai/api/mcp/auth_callback', match_type: 'exact' as const, enabled: true },
    { id: 3, label: 'Claude', pattern: 'https://claude.com/api/mcp/auth_callback', match_type: 'exact' as const, enabled: false },
  ],
  rejected: [] as McpRejectedRedirect[],
}

const USAGE = {
  users: [
    { user_id: 1, email: 'a@example.com', connections: 1, clients: ['ChatGPT'], last_used_at: '2026-09-05T18:30:00Z', calls_7d: 12, calls_30d: 40 },
    { user_id: 2, email: 'b@example.com', connections: 0, clients: [], last_used_at: null, calls_7d: 0, calls_30d: 3 },
  ],
  tools: [
    { tool: 'list_events', calls_7d: 8, calls_30d: 30 },
    { tool: 'get_dashboard', calls_7d: 4, calls_30d: 13 },
  ],
  calls_24h: 5, calls_7d: 12, calls_30d: 43,
  errors_7d: 2, denied_7d: 1, audit_rows: 43,
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'adminGetMcpUsage').mockResolvedValue(USAGE)
})

describe('AiConnections', () => {
  it('provides one admin MCP download for this site', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue(SETTINGS)
    render(<AiConnections onError={() => {}} />)
    await screen.findByText('Admin MCP')
    expect(screen.getByRole('link', { name: 'Download admin MCP' })).toHaveAttribute('href', '/api/admin/ai/plugin')
  })

  it('groups hosts under the product name an admin recognises', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue(SETTINGS)
    // No usage, so the only ChatGPT/Claude on the page is the provider list.
    vi.spyOn(api, 'adminGetMcpUsage').mockResolvedValue({
      ...USAGE, users: [], tools: [], calls_24h: 0, calls_7d: 0, calls_30d: 0,
      errors_7d: 0, denied_7d: 0, audit_rows: 0,
    })
    render(<AiConnections onError={() => {}} />)

    await screen.findByText('ChatGPT')
    // Claude is two hostnames but one thing to switch off.
    expect(screen.getAllByText('Claude')).toHaveLength(1)
    expect(screen.getByText('https://claude.ai/api/mcp/auth_callback')).toBeInTheDocument()
    expect(screen.getByText('https://claude.com/api/mcp/auth_callback')).toBeInTheDocument()
  })

  it('reports how many connections are live', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue(SETTINGS)
    render(<AiConnections onError={() => {}} />)
    await screen.findByText(/2 connections active/)
  })

  it('says so when nobody can connect because the list is empty', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue({ ...SETTINGS, hosts: [] })
    render(<AiConnections onError={() => {}} />)
    await screen.findByText(/No providers listed/)
  })

  it('toggles the master switch', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue(SETTINGS)
    const set = vi.spyOn(api, 'adminSetMcpEnabled')
      .mockResolvedValue({ ...SETTINGS, enabled: false })
    render(<AiConnections onError={() => {}} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }))
    expect(set).toHaveBeenCalledWith(false)
    await screen.findByRole('button', { name: 'Turn on' })
  })

  it('toggles a single provider', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue(SETTINGS)
    const toggle = vi.spyOn(api, 'adminToggleMcpHost').mockResolvedValue(SETTINGS)
    render(<AiConnections onError={() => {}} />)

    await screen.findByText('https://chatgpt.com/connector_platform_oauth_redirect')
    await userEvent.click(screen.getAllByRole('button', { name: 'Disable' })[0])
    expect(toggle).toHaveBeenCalledWith(1, false)
  })

  it('adds a provider and clears the form', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue(SETTINGS)
    const add = vi.spyOn(api, 'adminAddMcpHost').mockResolvedValue(SETTINGS)
    render(<AiConnections onError={() => {}} />)

    await userEvent.type(await screen.findByPlaceholderText('Copilot'), 'Copilot')
    await userEvent.type(screen.getByPlaceholderText('https://copilot.microsoft.com/oauth/callback'), 'copilot.microsoft.com')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(add).toHaveBeenCalledWith('Copilot', 'copilot.microsoft.com', undefined)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Copilot')).toHaveValue('')
    })
  })

  it('surfaces the server message when a change is refused', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue(SETTINGS)
    vi.spyOn(api, 'adminAddMcpHost').mockRejectedValue(new Error('chatgpt.com is already on the list'))
    const onError = vi.fn()
    render(<AiConnections onError={onError} />)

    await userEvent.type(await screen.findByPlaceholderText('Copilot'), 'Again')
    await userEvent.type(screen.getByPlaceholderText('https://copilot.microsoft.com/oauth/callback'), 'chatgpt.com')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('chatgpt.com is already on the list')
    })
  })

  it('passes the chosen match type when adding a rule', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue(SETTINGS)
    const add = vi.spyOn(api, 'adminAddMcpHost').mockResolvedValue(SETTINGS)
    render(<AiConnections onError={() => {}} />)

    await userEvent.type(await screen.findByPlaceholderText('Copilot'), 'Copilot')
    await userEvent.type(screen.getByPlaceholderText('https://copilot.microsoft.com/oauth/callback'), 'https://copilot.microsoft.com/oauth/')
    await userEvent.selectOptions(screen.getByLabelText('Match'), 'prefix')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(add).toHaveBeenCalledWith('Copilot', 'https://copilot.microsoft.com/oauth/', 'prefix')
  })

  const REFUSED = {
    id: 9, redirect_uri: 'https://copilot.microsoft.com/oauth/callback', client_name: 'Copilot',
    reason: 'not accepted', attempts: 3, first_seen: '2026-11-01T00:00:00Z', last_seen: '2026-11-02T00:00:00Z',
  }

  it('lists refused redirect addresses and allows one exactly', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue({ ...SETTINGS, rejected: [REFUSED] })
    const add = vi.spyOn(api, 'adminAddMcpHost').mockResolvedValue(SETTINGS)
    render(<AiConnections onError={() => {}} />)

    expect(await screen.findByText(REFUSED.redirect_uri)).toBeInTheDocument()
    expect(screen.getByText(/Copilot · 3 attempts/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Allow exactly' }))
    expect(add).toHaveBeenCalledWith('Copilot', REFUSED.redirect_uri, 'exact')
    await waitFor(() => expect(screen.queryByText(REFUSED.redirect_uri)).not.toBeInTheDocument())
  })

  it('dismisses a refused redirect address', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue({ ...SETTINGS, rejected: [REFUSED] })
    const dismiss = vi.spyOn(api, 'adminDismissRejectedRedirect').mockResolvedValue(SETTINGS)
    render(<AiConnections onError={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(dismiss).toHaveBeenCalledWith(9)
  })

  it('loads a refused address into the form to edit as a rule', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue({ ...SETTINGS, rejected: [REFUSED] })
    render(<AiConnections onError={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit as rule' }))
    expect(screen.getByPlaceholderText('https://copilot.microsoft.com/oauth/callback')).toHaveValue(REFUSED.redirect_uri)
    expect(screen.getByLabelText('Match')).toHaveValue('prefix')
  })

  it('reports usage per account and per tool', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue(SETTINGS)
    render(<AiConnections onError={() => {}} />)

    await screen.findByText('a@example.com')
    expect(screen.getByText('list_events')).toBeInTheDocument()
    expect(screen.getByText(/2 failed, 1 refused/)).toBeInTheDocument()
    // A disconnected account still shows its usage — hiding it would make the
    // record vanish exactly when someone looks into it.
    expect(screen.getByText(/\(disconnected\)/)).toBeInTheDocument()
  })

  it('keeps the controls when usage cannot be loaded', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue(SETTINGS)
    vi.spyOn(api, 'adminGetMcpUsage').mockRejectedValue(new Error('boom'))
    render(<AiConnections onError={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Turn off' })).toBeInTheDocument()
  })

  it('survives a response that is not the shape it expects', async () => {
    // This panel sits above others on the admin page; a bad response should
    // cost its own card, not every card below it.
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue({} as never)
    render(<AiConnections onError={() => {}} />)
    await screen.findByText('AI Connections')
  })
})

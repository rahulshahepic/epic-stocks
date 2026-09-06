import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiConnections } from '../scaffold/pages/admin/AiConnections.tsx'
import { api } from '../api.ts'

const SETTINGS = {
  enabled: true,
  connections: 2,
  hosts: [
    { id: 1, label: 'ChatGPT', host: 'chatgpt.com', enabled: true },
    { id: 2, label: 'Claude', host: 'claude.ai', enabled: true },
    { id: 3, label: 'Claude', host: 'claude.com', enabled: false },
  ],
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('AiConnections', () => {
  it('groups hosts under the product name an admin recognises', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue(SETTINGS)
    render(<AiConnections onError={() => {}} />)

    await screen.findByText('ChatGPT')
    // Claude is two hostnames but one thing to switch off.
    expect(screen.getAllByText('Claude')).toHaveLength(1)
    expect(screen.getByText('claude.ai')).toBeInTheDocument()
    expect(screen.getByText('claude.com')).toBeInTheDocument()
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

    await screen.findByText('chatgpt.com')
    await userEvent.click(screen.getAllByRole('button', { name: 'Disable' })[0])
    expect(toggle).toHaveBeenCalledWith(1, false)
  })

  it('adds a provider and clears the form', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue(SETTINGS)
    const add = vi.spyOn(api, 'adminAddMcpHost').mockResolvedValue(SETTINGS)
    render(<AiConnections onError={() => {}} />)

    await userEvent.type(await screen.findByPlaceholderText('Copilot'), 'Copilot')
    await userEvent.type(screen.getByPlaceholderText('copilot.microsoft.com'), 'copilot.microsoft.com')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(add).toHaveBeenCalledWith('Copilot', 'copilot.microsoft.com')
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
    await userEvent.type(screen.getByPlaceholderText('copilot.microsoft.com'), 'chatgpt.com')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('chatgpt.com is already on the list')
    })
  })

  it('survives a response that is not the shape it expects', async () => {
    // This panel sits above others on the admin page; a bad response should
    // cost its own card, not every card below it.
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue({} as never)
    render(<AiConnections onError={() => {}} />)
    await screen.findByText('AI Connections')
  })
})

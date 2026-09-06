import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiConnectionsSection } from '../scaffold/components/AiConnectionsSection.tsx'
import { api } from '../api.ts'

const CONNECTED = [
  {
    id: 7,
    client_name: 'ChatGPT',
    scopes: ['equity:read', 'comp:read'],
    created_at: '2026-09-01T10:00:00Z',
    last_used_at: '2026-09-05T18:30:00Z',
  },
]

const ACTIVITY = [
  { id: 3, client_name: 'ChatGPT', event: 'tool_call' as const, tool: 'get_compensation', outcome: 'ok', at: '2026-09-05T18:30:00Z' },
  { id: 2, client_name: 'ChatGPT', event: 'tool_call' as const, tool: 'list_grants', outcome: 'denied', at: '2026-09-05T18:29:00Z' },
  { id: 1, client_name: 'ChatGPT', event: 'connected' as const, tool: null, outcome: 'ok', at: '2026-09-01T10:00:00Z' },
]

beforeEach(() => {
  vi.restoreAllMocks()
  // Every test needs this; the ones that care override it.
  vi.spyOn(api, 'getAiActivity').mockResolvedValue([])
})

describe('AiConnectionsSection', () => {
  it('shows the address to paste, and copies it', async () => {
    vi.spyOn(api, 'getAiConnections').mockResolvedValue([])
    const write = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: write } })

    render(<AiConnectionsSection />)
    const expected = `${window.location.origin}/mcp`
    expect(await screen.findByText(expected)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(write).toHaveBeenCalledWith(expected)
    await screen.findByRole('button', { name: 'Copied' })
  })

  it('defaults to the Claude walkthrough, which is the shorter one', async () => {
    vi.spyOn(api, 'getAiConnections').mockResolvedValue([])
    render(<AiConnectionsSection />)
    expect(await screen.findByText(/Add custom connector/)).toBeInTheDocument()
  })

  it('warns that ChatGPT needs developer mode, and where it lives', async () => {
    vi.spyOn(api, 'getAiConnections').mockResolvedValue([])
    render(<AiConnectionsSection />)

    await userEvent.click(await screen.findByRole('tab', { name: 'ChatGPT' }))
    expect(screen.getByText('Developer mode')).toBeInTheDocument()
    expect(screen.getByText('Security and login')).toBeInTheDocument()
    // The switch reads like something you should not touch. Say otherwise.
    expect(screen.getByText(/sounds alarming and is not/)).toBeInTheDocument()
  })

  it('lists a connection with what it can read and when it was last used', async () => {
    vi.spyOn(api, 'getAiConnections').mockResolvedValue(CONNECTED)
    render(<AiConnectionsSection />)

    // Wait on a scope label, not on "ChatGPT": that also names the walkthrough
    // tab, so findByText resolves against the tab before the fetch has
    // returned and the assertions below then race the loading state. (Once the
    // list does arrive there are two matches, so it would throw instead.)
    expect(await screen.findByText(/Equity — grants, vesting/)).toBeInTheDocument()
    expect(screen.getByText(/Salary and retirement settings/)).toBeInTheDocument()
    expect(screen.getByText(/last used/)).toBeInTheDocument()
  })

  it('says plainly when nothing is connected', async () => {
    vi.spyOn(api, 'getAiConnections').mockResolvedValue([])
    render(<AiConnectionsSection />)
    expect(await screen.findByText('Nothing connected yet.')).toBeInTheDocument()
  })

  it('asks before disconnecting, then removes the row', async () => {
    vi.spyOn(api, 'getAiConnections').mockResolvedValue(CONNECTED)
    const disconnect = vi.spyOn(api, 'disconnectAi').mockResolvedValue(undefined)
    render(<AiConnectionsSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    expect(disconnect).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(disconnect).toHaveBeenCalledWith(7)
    await waitFor(() => {
      expect(screen.getByText('Nothing connected yet.')).toBeInTheDocument()
    })
  })

  it('lets a confirmation be backed out of', async () => {
    vi.spyOn(api, 'getAiConnections').mockResolvedValue(CONNECTED)
    const disconnect = vi.spyOn(api, 'disconnectAi')
    render(<AiConnectionsSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(disconnect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
  })

  it('reports a load failure rather than showing an empty list', async () => {
    vi.spyOn(api, 'getAiConnections').mockRejectedValue(new Error('boom'))
    render(<AiConnectionsSection />)
    expect(await screen.findByText(/Could not load your AI connections/)).toBeInTheDocument()
  })

  it('shows what an assistant actually read, once expanded', async () => {
    vi.spyOn(api, 'getAiConnections').mockResolvedValue(CONNECTED)
    vi.spyOn(api, 'getAiActivity').mockResolvedValue(ACTIVITY)
    render(<AiConnectionsSection />)

    // Collapsed by default — it is context, not the point of the section.
    await screen.findByText('Recent activity')
    expect(screen.queryByText('get_compensation')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('Recent activity'))
    expect(screen.getByText('get_compensation')).toBeInTheDocument()
    expect(screen.getByText(/list_grants — not permitted/)).toBeInTheDocument()
    expect(screen.getByText('connected')).toBeInTheDocument()
  })

  it('says the log holds no figures, because it does not', async () => {
    vi.spyOn(api, 'getAiConnections').mockResolvedValue(CONNECTED)
    vi.spyOn(api, 'getAiActivity').mockResolvedValue(ACTIVITY)
    render(<AiConnectionsSection />)

    await userEvent.click(await screen.findByText('Recent activity'))
    expect(screen.getByText(/never your figures/)).toBeInTheDocument()
  })

  it('hides the activity block entirely when there is nothing to show', async () => {
    vi.spyOn(api, 'getAiConnections').mockResolvedValue([])
    render(<AiConnectionsSection />)
    await screen.findByText('Nothing connected yet.')
    expect(screen.queryByText('Recent activity')).not.toBeInTheDocument()
  })

  it('keeps working when the activity call fails', async () => {
    vi.spyOn(api, 'getAiConnections').mockResolvedValue(CONNECTED)
    vi.spyOn(api, 'getAiActivity').mockRejectedValue(new Error('boom'))
    render(<AiConnectionsSection />)
    // The connections list, not the tab of the same name — otherwise this
    // passes without the list ever having loaded.
    expect(await screen.findByText(/Equity — grants, vesting/)).toBeInTheDocument()
    expect(screen.queryByText('Recent activity')).not.toBeInTheDocument()
  })

  it('is explicit that this is read-only', async () => {
    vi.spyOn(api, 'getAiConnections').mockResolvedValue([])
    render(<AiConnectionsSection />)
    expect(await screen.findByText(/cannot change anything/)).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ConnectAi from '../scaffold/pages/ConnectAi.tsx'
import { ReportContext } from '../scaffold/components/reportContext.ts'
import { ASSISTANT_GUIDES, mcpServerUrl } from '../scaffold/components/connectAiGuides.ts'
import { api } from '../api.ts'

let aiConnections = true
vi.mock('../scaffold/hooks/useConfig.ts', () => ({
  useConfig: () => ({ ai_connections: aiConnections, epic_mode: false, vapid_public_key: '', email_notifications_available: false, resend_from: '' }),
}))

const openReport = vi.fn()

function renderPage() {
  return render(
    <ReportContext.Provider value={{ openReport }}>
      <MemoryRouter><ConnectAi /></MemoryRouter>
    </ReportContext.Provider>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  openReport.mockReset()
  aiConnections = true
  try { localStorage.clear() } catch { /* ignore */ }
  vi.spyOn(api, 'getAiConnections').mockResolvedValue([])
  vi.spyOn(api, 'getAiActivity').mockResolvedValue([])
})

describe('Connect your AI', () => {
  it('offers every supported assistant in one dropdown', async () => {
    renderPage()
    const picker = await screen.findByLabelText('Your assistant')
    const names = Array.from((picker as HTMLSelectElement).options).map(o => o.textContent)
    expect(names).toEqual([
      'Claude', 'ChatGPT', 'Gemini', 'Grok', 'Muse', 'Perplexity', 'Mistral Le Chat', 'Manus',
    ])
  })

  it('shows the server address and copies it', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: write } })
    renderPage()
    expect(screen.getByLabelText('Server address')).toHaveValue(`${window.location.origin}/mcp`)
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(write).toHaveBeenCalledWith(`${window.location.origin}/mcp`)
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('points staging at the staging server', () => {
    expect(mcpServerUrl({ hostname: 'staging.epic-stocks.com', origin: 'https://staging.epic-stocks.com' }))
      .toBe('https://staging.epic-stocks.com/mcp')
  })

  it.each(ASSISTANT_GUIDES.map(g => [g.name, g]))('gives %s its own steps and names who gets the data', async (_name, guide) => {
    renderPage()
    await userEvent.selectOptions(screen.getByLabelText('Your assistant'), guide.id)
    for (const step of guide.steps) expect(screen.getByText(step)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`sent to ${guide.company} when`))).toBeInTheDocument()
  })

  it('keeps the no-address plugin downloads for Claude and ChatGPT', async () => {
    renderPage()
    expect(screen.getByRole('link', { name: 'download the Claude plugin' })).toHaveAttribute('href', '/api/ai/plugin/claude')
    await userEvent.selectOptions(screen.getByLabelText('Your assistant'), 'chatgpt')
    const link = screen.getByRole('link', { name: 'download the ChatGPT plugin' })
    expect(link).toHaveAttribute('href', '/api/ai/plugin/chatgpt')
    expect(link).toHaveAttribute('download', 'epic-stocks-chatgpt.zip')
  })

  it('shows ChatGPT workspace and Free plan limits before the setup steps', async () => {
    renderPage()
    await userEvent.selectOptions(screen.getByLabelText('Your assistant'), 'chatgpt')
    const notice = screen.getByText(/Epic’s ChatGPT Enterprise workspace currently blocks custom connectors/)
    expect(notice).toHaveTextContent('ChatGPT Free cannot add custom connectors')
    expect(notice).toHaveTextContent(/import your Eureka CSV or Stock Loan Statement directly/)
    const firstStep = screen.getByText(/^In ChatGPT on the web/)
    expect(notice.compareDocumentPosition(firstStep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('gives Muse a setup request carrying this server', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: write } })
    renderPage()
    await userEvent.selectOptions(screen.getByLabelText('Your assistant'), 'muse')
    await userEvent.click(screen.getByRole('button', { name: 'Copy Muse setup request' }))
    expect(write).toHaveBeenCalledWith(expect.stringContaining(`${window.location.origin}/mcp`))
    expect(write).toHaveBeenCalledWith(expect.stringContaining('OAuth with PKCE'))
  })

  it('remembers the chosen assistant', async () => {
    const { unmount } = renderPage()
    await userEvent.selectOptions(screen.getByLabelText('Your assistant'), 'grok')
    unmount()
    renderPage()
    expect(screen.getByLabelText('Your assistant')).toHaveValue('grok')
  })

  it('lets someone request an assistant that is not listed', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Request another assistant' }))
    expect(openReport).toHaveBeenCalledWith(expect.objectContaining({
      source: 'request', title: 'Request an assistant',
    }))
  })

  it('lets someone report that the chosen assistant would not connect', async () => {
    renderPage()
    await userEvent.selectOptions(screen.getByLabelText('Your assistant'), 'perplexity')
    await userEvent.click(screen.getByRole('button', { name: 'Perplexity would not connect' }))
    expect(openReport).toHaveBeenCalledWith(expect.objectContaining({
      source: 'request', message: expect.stringContaining('Perplexity'),
    }))
  })

  it('lists what is already connected without linking to itself', async () => {
    renderPage()
    await screen.findByText('Nothing connected yet.')
    expect(screen.queryByRole('link', { name: 'Connect an assistant' })).not.toBeInTheDocument()
  })

  it('sends people back to Settings when an admin has switched connections off', () => {
    aiConnections = false
    render(
      <MemoryRouter initialEntries={['/connect-ai']}>
        <ConnectAi />
      </MemoryRouter>,
    )
    expect(screen.queryByLabelText('Your assistant')).not.toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { AiConnectionsSection } from '../scaffold/components/AiConnectionsSection.tsx'
import { AiConnections } from '../scaffold/pages/admin/AiConnections.tsx'
import { api } from '../api.ts'

/**
 * Accessibility, checked here rather than only in the e2e suite.
 *
 * The e2e audit runs axe over whole pages in CI, which is where the walkthrough
 * lists were caught putting a <p> directly inside an <ol> — invalid structure,
 * and genuinely confusing with a screen reader, which announces a list's item
 * count and then reads something that is not an item. Catching it at the
 * component level means it fails in seconds locally instead of after a push.
 */

async function violations(container: HTMLElement) {
  const results = await axe.run(container, {
    resultTypes: ['violations'],
    // Contrast needs real layout, which jsdom does not do; the e2e audit
    // covers it against a real browser.
    rules: { 'color-contrast': { enabled: false } },
  })
  return results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
}

function summarise(found: Awaited<ReturnType<typeof violations>>) {
  return found.map(v => `[${v.impact}] ${v.id}: ${v.help}\n  ${v.nodes[0]?.html}`).join('\n\n')
}

const CONNECTED = [{
  id: 7,
  client_name: 'ChatGPT',
  scopes: ['equity:read', 'comp:read'],
  created_at: '2026-09-01T10:00:00Z',
  last_used_at: '2026-09-05T18:30:00Z',
}]

const ACTIVITY = [
  { id: 2, client_name: 'ChatGPT', event: 'tool_call' as const, tool: 'list_grants', outcome: 'ok', at: '2026-09-05T18:30:00Z' },
  { id: 1, client_name: 'ChatGPT', event: 'connected' as const, tool: null, outcome: 'ok', at: '2026-09-01T10:00:00Z' },
]

const USAGE = {
  users: [{ user_id: 1, email: 'a@example.com', connections: 1, clients: ['ChatGPT'], last_used_at: '2026-09-05T18:30:00Z', calls_7d: 12, calls_30d: 40 }],
  tools: [{ tool: 'list_events', calls_7d: 8, calls_30d: 30 }],
  calls_24h: 5, calls_7d: 12, calls_30d: 43, errors_7d: 2, denied_7d: 1, audit_rows: 43,
}

const SETTINGS = {
  enabled: true,
  connections: 1,
  hosts: [
    { id: 1, label: 'ChatGPT', host: 'chatgpt.com', enabled: true },
    { id: 2, label: 'Claude', host: 'claude.ai', enabled: false },
  ],
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('AI connections accessibility', () => {
  it('the Settings section is clean on the Claude walkthrough', async () => {
    vi.spyOn(api, 'getAiConnections').mockResolvedValue(CONNECTED)
    vi.spyOn(api, 'getAiActivity').mockResolvedValue(ACTIVITY)
    const { container } = render(<AiConnectionsSection />)
    await screen.findByText('ChatGPT')

    const found = await violations(container)
    expect(summarise(found)).toBe('')
  })

  it('the Settings section is clean on the ChatGPT walkthrough', async () => {
    vi.spyOn(api, 'getAiConnections').mockResolvedValue(CONNECTED)
    vi.spyOn(api, 'getAiActivity').mockResolvedValue(ACTIVITY)
    const { container } = render(<AiConnectionsSection />)

    await userEvent.click(await screen.findByRole('tab', { name: 'ChatGPT' }))
    const found = await violations(container)
    expect(summarise(found)).toBe('')
  })

  it('the Settings section is clean with the activity list open', async () => {
    vi.spyOn(api, 'getAiConnections').mockResolvedValue(CONNECTED)
    vi.spyOn(api, 'getAiActivity').mockResolvedValue(ACTIVITY)
    const { container } = render(<AiConnectionsSection />)

    await userEvent.click(await screen.findByText('Recent activity'))
    const found = await violations(container)
    expect(summarise(found)).toBe('')
  })

  it('the Settings section is clean with nothing connected', async () => {
    vi.spyOn(api, 'getAiConnections').mockResolvedValue([])
    vi.spyOn(api, 'getAiActivity').mockResolvedValue([])
    const { container } = render(<AiConnectionsSection />)
    await screen.findByText('Nothing connected yet.')

    const found = await violations(container)
    expect(summarise(found)).toBe('')
  })

  it('the admin panel is clean', async () => {
    vi.spyOn(api, 'adminGetMcp').mockResolvedValue(SETTINGS)
    vi.spyOn(api, 'adminGetMcpUsage').mockResolvedValue(USAGE)
    const { container } = render(<AiConnections onError={() => {}} />)
    await screen.findByText('a@example.com')

    const found = await violations(container)
    expect(summarise(found)).toBe('')
  })

  it('catches a list containing something that is not a list item', async () => {
    // The guard itself has to work, or the tests above pass by accident.
    const { container } = render(
      <ol><li>fine</li><p>not a list item</p></ol>,
    )
    await waitFor(async () => {
      expect((await violations(container)).map(v => v.id)).toContain('list')
    })
  })
})

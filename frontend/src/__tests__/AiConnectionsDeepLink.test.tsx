import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AiConnections } from '../scaffold/pages/admin/AiConnections.tsx'
import { targetRequestId } from '../scaffold/pages/admin/deepLink.ts'
import { api, type McpActionRequest } from '../api.ts'

const REQUEST: McpActionRequest = {
  id: 7,
  action: 'enable_redirect_rule',
  description: 'Switch a redirect rule back on',
  reason: null,
  status: 'pending',
  client_name: 'Claude',
  outcome: null,
  decided_by: null,
  requested_at: '2026-11-27T18:00:00Z',
  decided_at: null,
}

const SETTINGS = {
  enabled: true,
  connections: 1,
  hosts: [],
  rejected: [],
  requests: [REQUEST],
  request_history: [],
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'adminGetMcpUsage').mockResolvedValue({
    users: [], tools: [], calls_24h: 0, calls_7d: 0, calls_30d: 0,
    errors_7d: 0, denied_7d: 0, audit_rows: 0,
  })
  vi.spyOn(api, 'adminGetMcp').mockResolvedValue(SETTINGS)
  window.history.pushState({}, '', '/admin')
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  window.history.pushState({}, '', '/')
})

describe('targetRequestId', () => {
  it('parses a positive integer request id', () => {
    expect(targetRequestId('?request=7')).toBe(7)
    expect(targetRequestId('?other=1&request=42')).toBe(42)
  })

  it('rejects anything else', () => {
    expect(targetRequestId('')).toBeNull()
    expect(targetRequestId('?request=')).toBeNull()
    expect(targetRequestId('?request=abc')).toBeNull()
    expect(targetRequestId('?request=0')).toBeNull()
    expect(targetRequestId('?request=-3')).toBeNull()
    expect(targetRequestId('?request=7.5')).toBeNull()
  })
})

describe('AiConnections deep link (#825)', () => {
  it('gives every pending request a stable anchor id', async () => {
    render(<AiConnections onError={() => {}} />)
    await screen.findByText('Requests from AI assistants')
    expect(document.getElementById('admin-request-7')).not.toBeNull()
  })

  it('scrolls to and highlights the request named by ?request=', async () => {
    window.history.pushState({}, '', '/admin?request=7#ai-connections')
    render(<AiConnections onError={() => {}} />)
    const el = await waitFor(() => {
      const found = document.getElementById('admin-request-7')
      expect(found).not.toBeNull()
      return found!
    })
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
    expect(el.className).toContain('ring-2')
  })

  it('says so when the linked request is no longer pending', async () => {
    window.history.pushState({}, '', '/admin?request=99#ai-connections')
    render(<AiConnections onError={() => {}} />)
    expect(await screen.findByText(/no longer pending/)).toBeTruthy()
    expect(document.getElementById('admin-request-99')).toBeNull()
  })

  it('does not highlight when arrived at without a request id', async () => {
    render(<AiConnections onError={() => {}} />)
    const el = await waitFor(() => {
      const found = document.getElementById('admin-request-7')
      expect(found).not.toBeNull()
      return found!
    })
    expect(el.className).not.toContain('ring-2')
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })
})

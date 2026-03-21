import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Admin from '../pages/Admin.tsx'

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
})

function mockFetch(responses: Record<string, unknown>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    const method = init?.method ?? 'GET'
    for (const [path, data] of Object.entries(responses)) {
      if (url.includes(path)) {
        if (method === 'DELETE') return new Response(null, { status: 204 })
        return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
    }
    return new Response('{}', { status: 200 })
  })
}

const STATS = {
  total_users: 5, active_users_30d: 3,
  total_grants: 20, total_loans: 10, total_prices: 8,
  db_size_bytes: 524288,
}

const USERS = [
  { id: 1, email: 'admin@test.com', name: 'Admin', is_admin: true, created_at: '2025-01-01T00:00:00', last_login: '2025-06-01T00:00:00', grant_count: 5, loan_count: 3, price_count: 2 },
  { id: 2, email: 'user@test.com', name: 'User', is_admin: false, created_at: '2025-02-01T00:00:00', last_login: null, grant_count: 0, loan_count: 0, price_count: 0 },
]

const USERS_RESPONSE = { users: USERS, total: 2 }

function renderPage() {
  return render(<MemoryRouter><Admin /></MemoryRouter>)
}

describe('Admin', () => {
  it('renders stats overview', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument()  // total users
      expect(screen.getByText('3')).toBeInTheDocument()  // active
      expect(screen.getByText('20')).toBeInTheDocument() // grants
      expect(screen.getByText('512.0 KB')).toBeInTheDocument() // db size
    })
  })

  it('renders user list', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('admin@test.com')).toBeInTheDocument()
      expect(screen.getByText('user@test.com')).toBeInTheDocument()
    })
  })

  it('renders blocked emails section', async () => {
    mockFetch({
      '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE,
      '/api/admin/blocked': [{ id: 1, email: 'bad@evil.com', reason: 'Spam', blocked_at: '2025-01-01T00:00:00' }],
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('bad@evil.com')).toBeInTheDocument()
      expect(screen.getByText('(Spam)')).toBeInTheDocument()
      expect(screen.getByText('Unblock')).toBeInTheDocument()
    })
  })

  it('shows no blocked emails message when empty', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No blocked emails.')).toBeInTheDocument()
    })
  })

  it('shows error for non-admin users', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Admin access required' }), { status: 403 })
    )
    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/not have admin access/)).toBeInTheDocument()
    })
  })

  it('has block email form', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('email@example.com')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Reason (optional)')).toBeInTheDocument()
      expect(screen.getByText('Block')).toBeInTheDocument()
    })
  })

  it('shows user record counts', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/5 grants · 3 loans · 2 prices/)).toBeInTheDocument()
    })
  })

  it('delete requires confirmation click', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => {
      // Only non-admin user gets a Delete button
      expect(screen.getAllByText('Delete')).toHaveLength(1)
    })

    await userEvent.click(screen.getByText('Delete'))
    await waitFor(() => expect(screen.getByText('Confirm Delete')).toBeInTheDocument())
  })

  it('shows admin badge and hides delete button for admin users', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => {
      // Admin badge is a span inside the user row (distinct from the page heading)
      const badges = screen.getAllByText('Admin')
      // Page heading "Admin" + badge = 2
      expect(badges.length).toBeGreaterThanOrEqual(2)
      // Only 1 Delete button (for non-admin user)
      expect(screen.getAllByText('Delete')).toHaveLength(1)
    })
  })

  it('has a search input field', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search by email or name...')).toBeInTheDocument()
    })
  })

  it('renders test notification section', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Test Notification')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Send Now' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Send Now' })).toBeDisabled()
    })
  })

  it('Notify button pre-selects user in test notification form', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => expect(screen.getByText('user@test.com')).toBeInTheDocument())

    const notifyButtons = screen.getAllByRole('button', { name: 'Notify' })
    await userEvent.click(notifyButtons[0])

    const userSelect = screen.getByRole('combobox', { name: 'User' }) as HTMLSelectElement
    expect(userSelect.value).not.toBe('')
  })

  it('selecting a template pre-fills title and body', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Template' })).toBeInTheDocument())

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Template' }), 'vesting')

    const titleInput = screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement
    const bodyInput = screen.getByRole('textbox', { name: 'Body' }) as HTMLTextAreaElement
    expect(titleInput.value).toBe('Equity Tracker')
    expect(bodyInput.value).toBe('You have 1 event today: 1 Vesting')
  })

  it('each event type template uses correct content', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Template' })).toBeInTheDocument())

    const templateSelect = screen.getByRole('combobox', { name: 'Template' })
    const titleInput = screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement
    const bodyInput = screen.getByRole('textbox', { name: 'Body' }) as HTMLTextAreaElement

    await userEvent.selectOptions(templateSelect, 'exercise')
    expect(bodyInput.value).toBe('You have 1 event today: 1 Exercise')

    await userEvent.selectOptions(templateSelect, 'loan_repayment')
    expect(bodyInput.value).toBe('You have 1 event today: 1 Loan Repayment')
  })

  it('editing title/body resets template to custom', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Template' })).toBeInTheDocument())

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Template' }), 'vesting')
    const templateSelect = screen.getByRole('combobox', { name: 'Template' }) as HTMLSelectElement
    expect(templateSelect.value).toBe('vesting')

    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), ' extra')
    expect(templateSelect.value).toBe('custom')
  })

  it('shows send result after successful notification', async () => {
    const notifyResult = { push_sent: 2, push_failed: 1, email_sent: true }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      const method = init?.method ?? 'GET'
      if (url.includes('/api/admin/test-notify') && method === 'POST')
        return new Response(JSON.stringify(notifyResult), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.includes('/api/admin/stats')) return new Response(JSON.stringify(STATS), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.includes('/api/admin/users')) return new Response(JSON.stringify(USERS_RESPONSE), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.includes('/api/admin/blocked')) return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      return new Response('{}', { status: 200 })
    })
    renderPage()

    await waitFor(() => expect(screen.getByText('user@test.com')).toBeInTheDocument())

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'User' }), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Send Now' }))

    await waitFor(() => {
      expect(screen.getByText(/Push: 2 sent, 1 expired/)).toBeInTheDocument()
      expect(screen.getByText(/Email: sent/)).toBeInTheDocument()
    })
  })
})

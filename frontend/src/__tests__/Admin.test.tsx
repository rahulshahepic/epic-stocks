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
    expect(screen.getByText('Confirm Delete')).toBeInTheDocument()
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
})

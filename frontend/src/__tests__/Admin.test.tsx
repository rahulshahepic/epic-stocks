import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Admin from '../scaffold/pages/Admin.tsx'

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
    // Default: return empty arrays for list endpoints
    if (url.includes('/api/admin/metrics')) return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/api/admin/db-tables')) return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/api/admin/errors')) return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/api/admin/epic-mode')) return new Response(JSON.stringify({ active: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/api/admin/tips-report')) return new Response(JSON.stringify({ unique_users_accepted: 0, total_estimated_savings: 0, by_type: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    return new Response('{}', { status: 200 })
  })
}

const STATS = {
  total_users: 5, active_users_30d: 3,
  total_grants: 20, total_loans: 10, total_prices: 8,
  db_size_bytes: 524288,
  cpu_percent: 42.0, ram_used_mb: 2048.0, ram_total_mb: 8192.0,
}

const STATS_NO_METRICS = {
  total_users: 5, active_users_30d: 3,
  total_grants: 20, total_loans: 10, total_prices: 8,
  db_size_bytes: 524288,
  cpu_percent: null, ram_used_mb: null, ram_total_mb: null,
}

const USERS = [
  { id: 1, email: 'admin@test.com', name: 'Admin', is_admin: true, created_at: '2025-01-01T00:00:00', last_login: '2025-06-01T00:00:00', grant_count: 5, loan_count: 3, price_count: 2 },
  { id: 2, email: 'user@test.com', name: 'User', is_admin: false, created_at: '2025-02-01T00:00:00', last_login: null, grant_count: 0, loan_count: 0, price_count: 0 },
]

const USERS_RESPONSE = { users: USERS, total: 2 }


const METRICS = [
  { timestamp: '2026-03-23T10:00:00', cpu_percent: 30.0, ram_used_mb: 1000.0, ram_total_mb: 8192.0, db_size_bytes: 8500000, error_log_count: 0 },
  { timestamp: '2026-03-23T10:15:00', cpu_percent: 42.0, ram_used_mb: 2048.0, ram_total_mb: 8192.0, db_size_bytes: 8500000, error_log_count: 2 },
]

const DB_TABLES = [
  { table_name: 'error_logs', size_bytes: 4096000, row_estimate: 150 },
  { table_name: 'users', size_bytes: 65536, row_estimate: 3 },
]

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
      expect(screen.getAllByText('512.0 KB').length).toBeGreaterThanOrEqual(1) // db size
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

  it('renders test notification modal when Notify is clicked', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Notify' }).length).toBeGreaterThan(0))
    await userEvent.click(screen.getAllByRole('button', { name: 'Notify' })[0])

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    })
  })

  it('Notify button opens modal scoped to that user', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => expect(screen.getByText('user@test.com')).toBeInTheDocument())

    const notifyButtons = screen.getAllByRole('button', { name: 'Notify' })
    await userEvent.click(notifyButtons[0])

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Template' })).toBeInTheDocument())
    // Modal is scoped to the user — heading shows their name
    expect(screen.getByText(/Notify —/)).toBeInTheDocument()
  })

  it('selecting a template pre-fills title and body', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Notify' }).length).toBeGreaterThan(0))
    await userEvent.click(screen.getAllByRole('button', { name: 'Notify' })[0])
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

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Notify' }).length).toBeGreaterThan(0))
    await userEvent.click(screen.getAllByRole('button', { name: 'Notify' })[0])
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Template' })).toBeInTheDocument())

    const templateSelect = screen.getByRole('combobox', { name: 'Template' })
    const bodyInput = screen.getByRole('textbox', { name: 'Body' }) as HTMLTextAreaElement

    await userEvent.selectOptions(templateSelect, 'exercise')
    expect(bodyInput.value).toBe('You have 1 event today: 1 Exercise')

    await userEvent.selectOptions(templateSelect, 'loan_repayment')
    expect(bodyInput.value).toBe('You have 1 event today: 1 Loan Repayment')
  })

  it('editing title/body resets template to custom', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Notify' }).length).toBeGreaterThan(0))
    await userEvent.click(screen.getAllByRole('button', { name: 'Notify' })[0])
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
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    renderPage()

    await waitFor(() => expect(screen.getByText('user@test.com')).toBeInTheDocument())

    const notifyButtons = screen.getAllByRole('button', { name: 'Notify' })
    await userEvent.click(notifyButtons[0])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(screen.getByText(/Push: 2 sent, 1 expired/)).toBeInTheDocument()
      expect(screen.getByText(/Email: sent/)).toBeInTheDocument()
    })
  })

  // ============================================================
  // SYSTEM HEALTH SECTION
  // ============================================================

  it('renders System Health section', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('System Health')).toBeInTheDocument()
    })
  })

  it('shows current CPU and RAM percentages from stats', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('42%')).toBeInTheDocument()  // CPU
      expect(screen.getByText('25%')).toBeInTheDocument()  // RAM (2048/8192)
    })
  })

  it('shows dashes when no metrics collected yet', async () => {
    mockFetch({ '/api/admin/stats': STATS_NO_METRICS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => {
      expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    })
  })

  it('shows sparkline labels', async () => {
    mockFetch({
      '/api/admin/stats': STATS,
      '/api/admin/users': USERS_RESPONSE,
      '/api/admin/blocked': [],
      '/api/admin/metrics': METRICS,
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('CPU %')).toBeInTheDocument()
      expect(screen.getByText('RAM %')).toBeInTheDocument()
      expect(screen.getByText('DB size')).toBeInTheDocument()
    })
  })

  it('shows collecting message when not enough data', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => {
      const collecting = screen.getAllByText('collecting…')
      expect(collecting.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('renders time window toggle buttons', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '24h' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '72h' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '7d' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '30d' })).toBeInTheDocument()
    })
  })

  it('shows GB breakdown for RAM', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => {
      // 2048 MB / 1024 = 2.0 GB, 8192 MB / 1024 = 8.0 GB
      expect(screen.getByText(/2.0 \/ 8.0 GB/)).toBeInTheDocument()
    })
  })

  // ============================================================
  // DATABASE TABLES SECTION
  // ============================================================

  it('renders Database Tables section', async () => {
    mockFetch({ '/api/admin/stats': STATS, '/api/admin/users': USERS_RESPONSE, '/api/admin/blocked': [] })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Database Tables')).toBeInTheDocument()
    })
  })

  it('shows SQLite fallback message when no table data', async () => {
    mockFetch({
      '/api/admin/stats': STATS,
      '/api/admin/users': USERS_RESPONSE,
      '/api/admin/blocked': [],
      '/api/admin/db-tables': [],
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/only available on PostgreSQL/)).toBeInTheDocument()
    })
  })

  it('renders table rows when db-tables data provided', async () => {
    mockFetch({
      '/api/admin/stats': STATS,
      '/api/admin/users': USERS_RESPONSE,
      '/api/admin/blocked': [],
      '/api/admin/db-tables': DB_TABLES,
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('error_logs')).toBeInTheDocument()
      expect(screen.getByText('users')).toBeInTheDocument()
      expect(screen.getByText('3.9 MB')).toBeInTheDocument()  // 4096000 bytes
    })
  })

  it('shows PostgreSQL baseline note when tables are present', async () => {
    mockFetch({
      '/api/admin/stats': STATS,
      '/api/admin/users': USERS_RESPONSE,
      '/api/admin/blocked': [],
      '/api/admin/db-tables': DB_TABLES,
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/PostgreSQL baseline/)).toBeInTheDocument()
    })
  })

  // ============================================================
  // SMART TIPS REPORT SECTION
  // ============================================================

  it('renders Smart Tips section when tips data is present', async () => {
    const TIPS_REPORT = {
      unique_users_accepted: 7,
      total_estimated_savings: 42500,
      by_type: [
        { type: 'exit_date', unique_users: 3, total_savings: 18000 },
        { type: 'deduction', unique_users: 2, total_savings: 9500 },
        { type: 'method', unique_users: 2, total_savings: 15000 },
      ],
    }
    mockFetch({
      '/api/admin/stats': STATS,
      '/api/admin/users': USERS_RESPONSE,
      '/api/admin/blocked': [],
      '/api/admin/tips-report': TIPS_REPORT,
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Smart Tips')).toBeInTheDocument()
      expect(screen.getByText('7')).toBeInTheDocument()             // unique_users_accepted
      expect(screen.getByText('$42,500')).toBeInTheDocument()       // total_estimated_savings
      expect(screen.getByText('exit date')).toBeInTheDocument()     // type label
      expect(screen.getByText('$18,000 saved')).toBeInTheDocument() // per-type savings
    })
  })

  it('hides Smart Tips section when no tips have been accepted', async () => {
    mockFetch({
      '/api/admin/stats': STATS,
      '/api/admin/users': USERS_RESPONSE,
      '/api/admin/blocked': [],
      '/api/admin/tips-report': { unique_users_accepted: 0, total_estimated_savings: 0, by_type: [] },
    })
    renderPage()

    await waitFor(() => {
      expect(screen.queryByText('Smart Tips')).not.toBeInTheDocument()
    })
  })
})

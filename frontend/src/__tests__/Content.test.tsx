import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Content from '../app/pages/Content.tsx'
import { resetContentCache } from '../app/hooks/useContent.ts'
import { resetMeCache } from '../scaffold/hooks/useMe.ts'

const CONTENT = {
  grant_templates: [
    { id: 1, year: 2025, type: 'Purchase', vest_start: '2026-09-30', periods: 4, exercise_date: '2025-12-31', default_catch_up: false, show_dp_shares: true, default_purchase_due_month_day: '06-30', display_order: 0 },
  ],
  grant_type_defs: [
    { name: 'Purchase', color_class: 'bg-rose-700 text-white', description: 'You paid the share price', is_pre_tax_when_zero_price: false, display_order: 0 },
  ],
  bonus_schedule_variants: [],
  loan_rates: { interest: { '2025': 0.04 }, tax: {}, purchase_original: {} },
  loan_rates_all: [
    { id: 11, loan_kind: 'interest', grant_type: null, year: 2025, rate: 0.04, due_date: null },
  ],
  loan_refinances: { purchase: {}, tax: {} },
  loan_refinances_all: [],
  grant_program_settings: {
    loan_term_years: 10,
    tax_fallback_federal: 0.37, tax_fallback_state: 0.0765,
    flexible_payoff_enabled: false,
    latest_rate_year: 2025, price_years_start: 2018, price_years_end: 2026,
  },
}

const ADMIN_ME = { id: 1, email: 'admin@test.com', name: 'Admin', is_admin: true, is_content_admin: false }
const EDITOR_ME = { id: 2, email: 'editor@test.com', name: 'Editor', is_admin: false, is_content_admin: true }
const REGULAR_ME = { id: 3, email: 'regular@test.com', name: 'Regular', is_admin: false, is_content_admin: false }

function mockApi(me: typeof ADMIN_ME) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    const bodyTxt = typeof init?.body === 'string' ? init.body : undefined
    calls.push({ url, method, body: bodyTxt ? JSON.parse(bodyTxt) : undefined })
    if (url.includes('/api/me')) return new Response(JSON.stringify(me), { status: 200 })
    if (url.includes('/api/content/grant-templates')) return new Response(JSON.stringify({ id: 42 }), { status: 201 })
    if (url.includes('/api/content/grant-program-settings') && method === 'PUT') {
      return new Response(JSON.stringify({ id: 1 }), { status: 200 })
    }
    if (url.includes('/api/content')) return new Response(JSON.stringify(CONTENT), { status: 200 })
    return new Response('{}', { status: 200 })
  })
  return calls
}

beforeEach(() => {
  resetContentCache()
  resetMeCache()
  vi.restoreAllMocks()
  document.cookie = 'auth_hint=1'
})

function renderContent() {
  return render(
    <MemoryRouter>
      <Content />
    </MemoryRouter>,
  )
}

describe('Content page', () => {
  it('renders tabs and data for an admin', async () => {
    mockApi(ADMIN_ME)
    renderContent()
    await waitFor(() => expect(screen.getByText(/Grant-program content/)).toBeDefined())
    // Grant template row from CONTENT
    expect(screen.getByText('2026-09-30')).toBeDefined()
  })

  it('allows a content admin (non-admin) to use the page', async () => {
    mockApi(EDITOR_ME)
    renderContent()
    await waitFor(() => expect(screen.getByText(/Grant-program content/)).toBeDefined())
  })

  it('redirects a non-privileged user', async () => {
    mockApi(REGULAR_ME)
    renderContent()
    // Navigate renders nothing — wait for the admin-only heading to be absent
    await waitFor(() => {
      expect(screen.queryByText(/Grant-program content/)).toBeNull()
    })
  })

  it('POSTs a new grant template on Add', async () => {
    const calls = mockApi(ADMIN_ME)
    renderContent()
    await waitFor(() => expect(screen.getByText(/Grant-program content/)).toBeDefined())

    // Open the Add Template modal
    await userEvent.click(screen.getByRole('button', { name: /Add template/ }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined())

    await userEvent.clear(screen.getByLabelText('Year'))
    await userEvent.type(screen.getByLabelText('Year'), '2030')
    // Grant type comes from a select; default is Purchase (first entry in defs)
    const vestStart = screen.getByLabelText('Vest start') as HTMLInputElement
    await userEvent.type(vestStart, '2031-09-30')
    const exerciseDate = screen.getByLabelText('Exercise date') as HTMLInputElement
    await userEvent.type(exerciseDate, '2030-12-31')

    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    await waitFor(() => {
      const posted = calls.find(c => c.method === 'POST' && c.url.includes('/api/content/grant-templates'))
      expect(posted).toBeTruthy()
      expect((posted?.body as { year: number; type: string }).year).toBe(2030)
      expect((posted?.body as { year: number; type: string }).type).toBe('Purchase')
    })
  })

  it('opens an edit modal when a row is clicked and PUTs changes', async () => {
    const calls = mockApi(ADMIN_ME)
    renderContent()
    await waitFor(() => expect(screen.getByText(/Grant-program content/)).toBeDefined())

    // Click the existing row (year 2025)
    await userEvent.click(screen.getByText('2025'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined())

    const periods = screen.getByLabelText('Periods') as HTMLInputElement
    await userEvent.clear(periods)
    await userEvent.type(periods, '6')
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    await waitFor(() => {
      const put = calls.find(c => c.method === 'PUT' && c.url.includes('/api/content/grant-templates/1'))
      expect(put).toBeTruthy()
      expect((put?.body as { periods: number }).periods).toBe(6)
    })
  })

  it('deletes a row from the edit modal', async () => {
    const calls = mockApi(ADMIN_ME)
    renderContent()
    await waitFor(() => expect(screen.getByText(/Grant-program content/)).toBeDefined())

    await userEvent.click(screen.getByText('2025'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined())
    await userEvent.click(screen.getByRole('button', { name: /^Delete$/ }))

    await waitFor(() => {
      const del = calls.find(c => c.method === 'DELETE' && c.url.includes('/api/content/grant-templates/1'))
      expect(del).toBeTruthy()
    })
  })

  it('PUTs grant-program-settings when toggling flexible payoff', async () => {
    const calls = mockApi(ADMIN_ME)
    renderContent()
    await waitFor(() => expect(screen.getByText(/Grant-program content/)).toBeDefined())

    await userEvent.click(screen.getByRole('button', { name: /Program Settings/ }))
    await userEvent.click(screen.getByLabelText(/Flexible loan-payoff methods/i))
    await userEvent.click(screen.getByRole('button', { name: /Save settings/ }))

    await waitFor(() => {
      const put = calls.find(c => c.method === 'PUT' && c.url.includes('/api/content/grant-program-settings'))
      expect(put).toBeTruthy()
      expect((put?.body as { flexible_payoff_enabled: boolean }).flexible_payoff_enabled).toBe(true)
    })
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ImportDiagnostics from '../app/pages/ImportDiagnostics.tsx'
import { resetMeCache } from '../scaffold/hooks/useMe.ts'

const ADMIN = { id: 1, email: 'admin@test.com', name: 'Admin', is_admin: true, is_content_admin: false }
const REGULAR = { id: 2, email: 'user@test.com', name: 'User', is_admin: false, is_content_admin: false }

const DIFF = {
  proposal: {
    statement_date: '2024-02-01',
    conventions: { vest_month: 3, vest_day: 1 },
    grants: [], loans: [], prices: [],
    findings: [
      { code: 'G3', severity: 'warning', subject: '2022 Bonus Shares', message: 'Basis does not match the year price.' },
    ],
  },
  report: {
    differences: [
      { entity: 'grant', key: '2022 Purchase', field: 'shares', imported: '300,000',
        existing: '999', rule: 'G2', severity: 'error', note: '' },
    ],
    conventions: { vest_month: 3, vest_day: 1 },
    counts: {
      imported_grants: 8, existing_grants: 8, imported_loans: 9,
      existing_loans: 9, imported_prices: 3, existing_prices: 3,
    },
    errors: 1, warnings: 0,
  },
  report_with_defaults: { differences: [{}, {}, {}], conventions: {}, counts: {}, errors: 1, warnings: 2 },
  markdown: '# Epic import reconciliation\n',
}

function mockApi(me: typeof ADMIN, diff: unknown = DIFF) {
  const posts: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/api/me')) return new Response(JSON.stringify(me), { status: 200 })
    if (url.includes('/api/epic-import/diff')) {
      posts.push(url)
      return new Response(JSON.stringify(diff), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  })
  return posts
}

function file(name: string, type: string) {
  return new File(['x'], name, { type })
}

async function renderPage() {
  render(<MemoryRouter><ImportDiagnostics /></MemoryRouter>)
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
}

describe('ImportDiagnostics', () => {
  beforeEach(() => { resetMeCache() })
  afterEach(() => { vi.restoreAllMocks() })

  it('is not reachable by a non-admin', async () => {
    mockApi(REGULAR)
    await renderPage()
    await waitFor(() => {
      expect(screen.queryByText('Import diagnostics')).not.toBeInTheDocument()
    })
  })

  it('needs an export and at least one Epic file before it will run', async () => {
    mockApi(ADMIN)
    await renderPage()
    const compare = await screen.findByRole('button', { name: 'Compare' })
    expect(compare).toBeDisabled()

    await userEvent.upload(screen.getByLabelText(/Your export/), file('e.xlsx', 'application/vnd.ms-excel'))
    expect(compare).toBeDisabled()

    await userEvent.upload(screen.getByLabelText(/share summary/i), file('s.csv', 'text/csv'))
    expect(compare).toBeEnabled()
  })

  it('shows each difference with the rule that produced it', async () => {
    mockApi(ADMIN)
    await renderPage()
    await userEvent.upload(await screen.findByLabelText(/Your export/), file('e.xlsx', 'application/vnd.ms-excel'))
    await userEvent.upload(screen.getByLabelText(/share summary/i), file('s.csv', 'text/csv'))
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }))

    expect(await screen.findByText('G2')).toBeInTheDocument()
    expect(screen.getByText('grant 2022 Purchase')).toBeInTheDocument()
    expect(screen.getByText('300,000')).toBeInTheDocument()
    expect(screen.getByText('999')).toBeInTheDocument()
    expect(screen.getByText(/1 error/)).toBeInTheDocument()
  })

  it('reports findings raised from the files themselves', async () => {
    mockApi(ADMIN)
    await renderPage()
    await userEvent.upload(await screen.findByLabelText(/Your export/), file('e.xlsx', 'application/vnd.ms-excel'))
    await userEvent.upload(screen.getByLabelText(/share summary/i), file('s.csv', 'text/csv'))
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }))

    expect(await screen.findByText('G3')).toBeInTheDocument()
    expect(screen.getByText(/Basis does not match/)).toBeInTheDocument()
  })

  it('says so plainly when nothing differs', async () => {
    mockApi(ADMIN, {
      ...DIFF,
      report: { ...DIFF.report, differences: [], errors: 0, warnings: 0 },
      report_with_defaults: { ...DIFF.report_with_defaults, differences: [] },
    })
    await renderPage()
    await userEvent.upload(await screen.findByLabelText(/Your export/), file('e.xlsx', 'application/vnd.ms-excel'))
    await userEvent.upload(screen.getByLabelText(/share summary/i), file('s.csv', 'text/csv'))
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }))

    expect(await screen.findByText(/reproduces your data exactly/)).toBeInTheDocument()
  })

  it('surfaces a server error instead of a blank report', async () => {
    resetMeCache()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/me')) return new Response(JSON.stringify(ADMIN), { status: 200 })
      return new Response(JSON.stringify({ detail: 'The export has no Schedule sheet' }), { status: 400 })
    })
    await renderPage()
    await userEvent.upload(await screen.findByLabelText(/Your export/), file('e.xlsx', 'application/vnd.ms-excel'))
    await userEvent.upload(screen.getByLabelText(/share summary/i), file('s.csv', 'text/csv'))
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }))

    expect(await screen.findByText('The export has no Schedule sheet')).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EpicFileImport from '../app/components/EpicFileImport.tsx'

const PREVIEW = {
  proposal: {
    statement_date: '2024-02-01',
    conventions: {},
    grants: [], loans: [], prices: [],
    findings: [
      { code: 'G4', severity: 'warning', subject: '2020 Purchased',
        message: 'Fully vested in the CSV, so the vesting schedule is not visible.' },
    ],
  },
  plan: {
    grants_created: ['2024 Purchase'], grants_updated: 7,
    loans_created: ['100010'], loans_updated: 8,
    prices_created: ['2024-03-01'], loans_not_on_statement: ['099999'],
  },
  report: { differences: [], conventions: {}, counts: {}, errors: 0, warnings: 0 },
}

const APPLIED = {
  grants_created: 1, grants_updated: 7, loans_created: 1, loans_updated: 8,
  prices_created: 1, loans_not_on_statement: ['099999'], findings: [],
}

function mockApi(preview: unknown = PREVIEW) {
  const calls: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    calls.push(url)
    if (url.includes('/preview')) return new Response(JSON.stringify(preview), { status: 200 })
    if (url.includes('/apply')) return new Response(JSON.stringify(APPLIED), { status: 201 })
    return new Response('{}', { status: 200 })
  })
  return calls
}

const csv = () => new File(['a,b'], 'shares.csv', { type: 'text/csv' })

async function uploadAndPreview() {
  render(<EpicFileImport />)
  await userEvent.upload(screen.getByLabelText(/Share summary/i), csv())
  await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
}

describe('EpicFileImport', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('will not preview until a file is chosen', () => {
    mockApi()
    render(<EpicFileImport />)
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()
  })

  it('previews without writing anything', async () => {
    const calls = mockApi()
    await uploadAndPreview()
    expect(await screen.findByText(/Statement dated 2024-02-01/)).toBeInTheDocument()
    expect(calls.every(u => u.includes('/preview'))).toBe(true)
  })

  it('shows what would change and what would be left alone', async () => {
    mockApi()
    await uploadAndPreview()
    expect(await screen.findByText('1 new, 7 updated')).toBeInTheDocument()
    expect(screen.getByText(/not on this\s+statement/)).toBeInTheDocument()
    expect(screen.getByText(/Fully vested in the CSV/)).toBeInTheDocument()
  })

  it('leaves schedules and prices alone unless asked', async () => {
    const calls = mockApi()
    await uploadAndPreview()
    await userEvent.click(await screen.findByRole('button', { name: 'Import' }))
    await waitFor(() => expect(calls.some(u => u.includes('/apply'))).toBe(true))
    const applyUrl = calls.find(u => u.includes('/apply'))!
    expect(applyUrl).toContain('adopt_schedule=false')
    expect(applyUrl).toContain('overwrite_prices=false')
  })

  it('passes the opt-ins through when they are ticked', async () => {
    const calls = mockApi()
    await uploadAndPreview()
    await userEvent.click(await screen.findByLabelText(/Also update vesting schedules/))
    await userEvent.click(screen.getByLabelText(/Overwrite share prices/))
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(calls.some(u => u.includes('/apply'))).toBe(true))
    const applyUrl = calls.find(u => u.includes('/apply'))!
    expect(applyUrl).toContain('adopt_schedule=true')
    expect(applyUrl).toContain('overwrite_prices=true')
  })

  it('blocks the import when the files did not add up', async () => {
    mockApi({
      ...PREVIEW,
      proposal: {
        ...PREVIEW.proposal,
        findings: [{ code: 'C3', severity: 'error', subject: '2020 Purchased',
                     message: 'Loan balances do not reconcile.' }],
      },
    })
    await uploadAndPreview()
    expect(await screen.findByRole('button', { name: 'Import' })).toBeDisabled()
    expect(screen.getByText(/Fix the 1 error/)).toBeInTheDocument()
  })

  it('reports what was imported', async () => {
    mockApi()
    await uploadAndPreview()
    await userEvent.click(await screen.findByRole('button', { name: 'Import' }))
    expect(await screen.findByText(/1 grants added, 7 updated/)).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import EpicFileImport from '../app/components/EpicFileImport.tsx'

const CLEAN = {
  draft: {
    statement_date: '2024-02-01',
    prices: [{ effective_date: '2020-01-01', price: 1.99 },
      { effective_date: '2021-01-01', price: 2.50 }],
  },
  price_is_stale: false,
  changes: [
    { kind: 'grant', action: 'create', label: '2026 Purchase grant', detail: '1,000 shares at $2.00',
      values: { year: 2026 }, selected: true, group: 'add' },
    { kind: 'loan', action: 'delete', id: 4, version: 1, label: '2021 Purchase interest loan 222',
      detail: '$1,000.00 — not on your statement', selected: true, group: 'remove' },
  ],
  unanswered_sales: [],
  findings: [],
  blocked: false,
  reconciles: true,
  prompt: 'PASTE ME. Return only the JSON object.',
  summary: {
    grants: 8, loans: 9, prices: 3,
    total_shares: 679000, total_loan_balance: 3795000, grant_years: [2020, 2021],
  },
  origin: 'parsed',
}

const DISAGREES = {
  ...CLEAN,
  findings: [
    { code: 'C3', severity: 'error', subject: '2022 Purchased',
      message: 'The stock workbook reports a loan balance of 2,000,000.00.' },
  ],
  reconciles: false,
}

const BLOCKED = {
  ...DISAGREES,
  blocked: true,
  findings: [
    { code: 'C1', severity: 'error', subject: '2031',
      message: "The statement's own subtotal for 2031 is 2,032,000.00." },
  ],
}

function mockApi(...responses: unknown[]) {
  const calls: Array<{ url: string; body: FormData | null }> = []
  let i = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/api/content')) return new Response('{}', { status: 500 })
    calls.push({ url, body: (init?.body as FormData) ?? null })
    const body = responses[Math.min(i, responses.length - 1)]
    i += 1
    return new Response(JSON.stringify(body), { status: 200 })
  })
  return calls
}

const csv = () => new File(['a,b'], 'shares.csv', { type: 'text/csv' })

/** The card links elsewhere, which needs router context. */
function renderCard(onApplied?: () => void) {
  return render(<MemoryRouter><EpicFileImport onApplied={onApplied} /></MemoryRouter>)
}

async function readFiles() {
  await userEvent.upload(screen.getByLabelText(/Data for Stock Workbook/i), csv())
  await userEvent.click(screen.getByRole('button', { name: 'Read my files' }))
}

describe('EpicFileImport', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('will not read until a file is chosen', () => {
    mockApi(CLEAN)
    renderCard()
    expect(screen.getByRole('button', { name: 'Read my files' })).toBeDisabled()
  })

  it('shows figures a person can recognise, not the file', async () => {
    mockApi(CLEAN)
    renderCard()
    await readFiles()
    expect(await screen.findByText('679,000')).toBeInTheDocument()
    expect(screen.getByText('$3,795,000')).toBeInTheDocument()
    expect(screen.getByText(/You can preview these changes/)).toBeInTheDocument()
  })

  it('offers no assistant help when nothing disagrees', async () => {
    mockApi(CLEAN)
    renderCard()
    await readFiles()
    expect(await screen.findByRole('button', { name: 'Check 2 changes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy prompt' })).not.toBeInTheDocument()
  })

  it('offers the prompt when the two files disagree, but still lets you proceed', async () => {
    mockApi(DISAGREES)
    renderCard()
    await readFiles()
    expect(await screen.findByText(/1 figure\(s\) do not agree/)).toBeInTheDocument()
    expect(screen.getByText('C3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check 2 changes' })).toBeInTheDocument()
  })

  it('refuses to proceed when the statement itself was misread', async () => {
    mockApi(BLOCKED)
    renderCard()
    await readFiles()
    expect(await screen.findByText(/does not add up to its own totals/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Check \d+ change/ })).not.toBeInTheDocument()
  })

  it('says the figures go wherever the user chooses, not to the app', async () => {
    mockApi(BLOCKED)
    renderCard()
    await readFiles()
    expect(await screen.findByText(/this app does not send\s+them anywhere/)).toBeInTheDocument()
  })

  it('sends a pasted reply back to be checked the same way', async () => {
    const calls = mockApi(BLOCKED, CLEAN)
    renderCard()
    await readFiles()
    await userEvent.type(await screen.findByLabelText(/Paste the reply/), 'grants-json')
    await userEvent.click(screen.getByRole('button', { name: 'Check this' }))

    await waitFor(() => expect(calls.length).toBe(2))
    expect(calls[1].body?.get('revised_json')).toContain('grants')
    expect(await screen.findByText(/You can preview these changes/)).toBeInTheDocument()
  })

  it('accepts the reply as a file too', async () => {
    const calls = mockApi(BLOCKED, CLEAN)
    renderCard()
    await readFiles()
    await userEvent.upload(
      await screen.findByLabelText(/Upload the reply as a file/),
      new File(['{}'], 'fixed.json', { type: 'application/json' }),
    )
    await waitFor(() => expect(calls.length).toBe(2))
    expect(calls[1].body?.get('revised_draft')).toBeTruthy()
  })

  it('keeps the loop going until it comes back clean', async () => {
    const calls = mockApi(BLOCKED, DISAGREES, CLEAN)
    renderCard()
    await readFiles()

    await userEvent.type(await screen.findByLabelText(/Paste the reply/), 'a')
    await userEvent.click(screen.getByRole('button', { name: 'Check this' }))
    expect(await screen.findByText(/1 figure\(s\) do not agree/)).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/Paste the reply/), 'b')
    await userEvent.click(screen.getByRole('button', { name: 'Check this' }))
    expect(await screen.findByText(/You can preview these changes/)).toBeInTheDocument()
    expect(calls.length).toBe(3)
  })

  it('surfaces a server error instead of a blank panel', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/content')) return new Response('{}', { status: 500 })
      return new Response(JSON.stringify({ detail: 'That is not valid JSON' }), { status: 400 })
    })
    renderCard()
    await readFiles()
    expect(await screen.findByText('That is not valid JSON')).toBeInTheDocument()
  })
})

describe('EpicFileImport → one screen of changes', () => {
  afterEach(() => { vi.restoreAllMocks() })
  const PREVIEW = { applied: false, changes: [], confirm: 'tok',
    position_before: { outstanding_loan_balance: 1000 }, position_after: { outstanding_loan_balance: 0 } }
  const SAVED = { applied: true, changes: [{ kind: 'grant', action: 'create', id: 9, label: 'x' }],
    position_before: {}, position_after: {} }

  it('lists what would change, grouped, every row ticked', async () => {
    mockApi(CLEAN)
    renderCard()
    await readFiles()
    expect(await screen.findByText('What we found')).toBeVisible()
    expect(screen.getByText('2026 Purchase grant')).not.toBeVisible()
    await userEvent.click(screen.getByText('Review individual records'))
    expect(screen.getByText('2026 Purchase grant')).toBeVisible()
    expect(screen.getByText(/not on your statement/)).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox').filter(c => !c.closest('label')?.textContent?.includes('Help improve setup')).every(c => (c as HTMLInputElement).checked)).toBe(true)
  })

  it('checks, then saves exactly the ticked changes with the preview token', async () => {
    const calls = mockApi(CLEAN, PREVIEW, SAVED)
    renderCard()
    await readFiles()
    await userEvent.click(await screen.findByText('Review individual records'))
    await userEvent.click(screen.getByLabelText(/2021 Purchase interest loan 222/))
    await userEvent.click(screen.getByRole('button', { name: 'Check 1 change' }))
    expect(await screen.findByText('$1,000 → $0')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save 1 change' }))
    expect(await screen.findByText(/Saved 1 change/)).toBeInTheDocument()

    const preview = JSON.parse(String(calls[1].body))
    const apply = JSON.parse(String(calls[2].body))
    expect(calls[1].url).toContain('/api/changes/preview')
    expect(preview.changes.map((c: { label: string }) => c.label)).toEqual(['2026 Purchase grant'])
    expect(calls[2].url).toContain('/api/changes/apply')
    expect(apply.confirm).toBe('tok')
    expect(apply.changes).toEqual(preview.changes)
  })

  it('adds a sale only once the person gives its date and price', async () => {
    const calls = mockApi({ ...CLEAN, unanswered_sales: [{ shares: 500, date: null, price_per_share: null, notes: 'n' }] },
      PREVIEW)
    renderCard()
    await readFiles()
    expect(await screen.findByRole('button', { name: 'Check 2 changes' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Date'), '2024-03-01')
    await userEvent.type(screen.getByLabelText('Price per share'), '12.5')
    await userEvent.click(screen.getByRole('button', { name: 'Check 3 changes' }))
    await waitFor(() => expect(calls.length).toBe(2))
    const sent = JSON.parse(String(calls[1].body)).changes
    expect(sent[2]).toMatchObject({ kind: 'sale', action: 'create',
      values: { date: '2024-03-01', shares: 500, price_per_share: 12.5 } })
  })
})

describe('EpicFileImport — current share price', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('locks the import source and hides old changes while repricing', async () => {
    mockApi({...CLEAN, price_is_stale: true})
    renderCard()
    await readFiles()
    let finish!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await userEvent.type(await screen.findByLabelText('Current share price'), '20')
    await userEvent.click(screen.getByRole('button', {name: 'Use this price'}))
    expect(screen.getByLabelText('Stock files (.csv, .xlsx, .pdf)')).toBeDisabled()
    expect(screen.getByLabelText(/Data for Stock Workbook/)).toBeDisabled()
    expect(screen.queryByRole('button', {name: 'Check 2 changes'})).toBeNull()
    finish(new Response(JSON.stringify(CLEAN), {status: 200}))
    expect(await screen.findByRole('button', {name: 'Check 2 changes'})).toBeEnabled()
  })

  it('locks repricing and source selection while checking changes', async () => {
    mockApi({...CLEAN, price_is_stale: true})
    renderCard()
    await readFiles()
    let finish!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await userEvent.click(await screen.findByRole('button', {name: 'Check 2 changes'}))
    expect(screen.getByLabelText('Current share price')).toBeDisabled()
    expect(screen.getByLabelText('Stock files (.csv, .xlsx, .pdf)')).toBeDisabled()
    finish(new Response(JSON.stringify({confirm: 'fictional', changes: CLEAN.changes, position_before: {}, position_after: {}}), {status: 200}))
    expect(await screen.findByRole('button', {name: 'Save 2 changes'})).toBeEnabled()
    expect(screen.getByLabelText('Current share price')).toBeEnabled()
  })

  it('asks for it when the files carry only older prices', async () => {
    mockApi({ ...CLEAN, price_is_stale: true })
    renderCard()
    await readFiles()

    expect(await screen.findByText(/newest price in your files/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Current share price')).toBeInTheDocument()
  })

  it('stays quiet when the files are already current', async () => {
    mockApi(CLEAN)   // price_is_stale: false
    renderCard()
    await readFiles()

    await screen.findByText(/You can preview these changes/)
    expect(screen.queryByLabelText('Current share price')).not.toBeInTheDocument()
  })

  it('re-reads the files with the entered price, so it saves with the rest', async () => {
    const calls = mockApi({ ...CLEAN, price_is_stale: true })
    renderCard()
    await readFiles()

    await userEvent.type(await screen.findByLabelText('Current share price'), '7.25')
    await userEvent.click(screen.getByRole('button', { name: 'Use this price' }))

    await waitFor(() => expect(calls.length).toBe(2))
    expect(calls[1].body?.get('current_price')).toBe('7.25')
    expect(await screen.findByText(/entered for today/)).toBeInTheDocument()
  })
})

it('notifies the owning page after a confirmed import save', async () => {
  const onApplied = vi.fn()
  mockApi(CLEAN, {confirm: 'fictional-confirmation', changes: CLEAN.changes, position_before: {}, position_after: {}},
    {changes: CLEAN.changes, position_before: {}, position_after: {}})
  renderCard(onApplied)
  await readFiles()
  await userEvent.click(await screen.findByRole('button', {name: 'Check 2 changes'}))
  expect(onApplied).not.toHaveBeenCalled()
  await userEvent.click(await screen.findByRole('button', {name: 'Save 2 changes'}))
  await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
})

it('keeps advisory checks collapsed while showing actionable findings', async () => {
  mockApi({...CLEAN, findings: [
    {code: 'G1', severity: 'warning', subject: 'Custom award', message: 'Confirm this award'},
    {code: 'C9', severity: 'warning', subject: 'Loan', message: 'Rate differs'},
  ]})
  renderCard()
  await readFiles()
  expect(await screen.findByText('Needs you')).toBeVisible()
  expect(screen.getByText('Confirm this award')).toBeVisible()
  expect(screen.getByText(/^FYI ·/).closest('details')).not.toHaveAttribute('open')
})

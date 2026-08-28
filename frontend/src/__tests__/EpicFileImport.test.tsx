import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import EpicFileImport from '../app/components/EpicFileImport.tsx'
import { resetContentCache, setContentCacheForTesting } from '../app/hooks/useContent.ts'
import { MOCK_CONTENT } from './fixtures/content.ts'
import type { ContentBlob } from '../api.ts'

const CLEAN = {
  draft: { statement_date: '2024-02-01' },
  wizard_payload: { grants: [], prices: [] },
  wizard_prefill: { grants: [], loans: [], prices: [] },
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

/** The card renders the wizard on handoff, and the wizard needs router context. */
function renderCard() {
  return render(<MemoryRouter><EpicFileImport /></MemoryRouter>)
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
    expect(screen.getByText(/Everything reconciles/)).toBeInTheDocument()
  })

  it('offers no assistant help when nothing disagrees', async () => {
    mockApi(CLEAN)
    renderCard()
    await readFiles()
    expect(await screen.findByRole('button', { name: 'Review and finish' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy prompt' })).not.toBeInTheDocument()
  })

  it('offers the prompt when the two files disagree, but still lets you proceed', async () => {
    mockApi(DISAGREES)
    renderCard()
    await readFiles()
    expect(await screen.findByText(/1 figure\(s\) do not agree/)).toBeInTheDocument()
    expect(screen.getByText('C3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review anyway' })).toBeInTheDocument()
  })

  it('refuses to proceed when the statement itself was misread', async () => {
    mockApi(BLOCKED)
    renderCard()
    await readFiles()
    expect(await screen.findByText(/does not add up to its own totals/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Review/ })).not.toBeInTheDocument()
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
    expect(await screen.findByText(/Everything reconciles/)).toBeInTheDocument()
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
    expect(await screen.findByText(/Everything reconciles/)).toBeInTheDocument()
    expect(calls.length).toBe(3)
  })

  it('hands off to the wizard rather than asking you to sign off on a file', async () => {
    mockApi(CLEAN)
    renderCard()
    await readFiles()
    await userEvent.click(await screen.findByRole('button', { name: 'Review and finish' }))
    expect(await screen.findByText('Review your import')).toBeInTheDocument()
    expect(screen.getByText(/Nothing has been saved yet/)).toBeInTheDocument()
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

describe('EpicFileImport → wizard handoff', () => {
  beforeEach(() => {
    resetContentCache()
    setContentCacheForTesting(MOCK_CONTENT as ContentBlob)
  })
  afterEach(() => { vi.restoreAllMocks(); resetContentCache() })

  it('shows the reviewed figures, not a menu asking how to start', async () => {
    // Someone who has just uploaded their documents has already chosen a path.
    // Landing them back on "choose how you'd like to get started" strands them.
    mockApi(CLEAN)
    renderCard()
    await userEvent.upload(screen.getByLabelText(/Data for Stock Workbook/i), csv())
    await userEvent.click(screen.getByRole('button', { name: 'Read my files' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Review and finish' }))

    expect(await screen.findByText('Review your import')).toBeInTheDocument()
    // The wizard rendered, and it skipped straight past its own welcome menu.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Enter it myself/i })).not.toBeInTheDocument()
    })
    expect(screen.queryByText(/Choose how you|quickest way/i)).not.toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import AssistantImport from '../app/components/AssistantImport.tsx'
import { api, type ImportProposal } from '../api.ts'

vi.mock('../app/components/ImportWizard.tsx', () => ({
  default: ({ prefill }: { prefill?: { grants: unknown[] } }) => (
    <div data-testid="wizard">wizard with {prefill?.grants.length ?? 0} grants</div>
  ),
}))

const PROPOSAL: ImportProposal = {
  client_name: 'ChatGPT',
  created_at: '2026-09-06T18:30:00Z',
  blocked: false,
  grants: 3,
  prices: 5,
  findings: [],
  wizard_prefill: {
    grants: [{ id: -1, year: 2021, type: 'Purchase', shares: 1000, price: 2.83,
      vest_start: '2022-09-30', periods: 5, exercise_date: '2021-12-31',
      dp_shares: 0, election_83b: false, version: 1 }],
    loans: [],
    prices: [],
  } as ImportProposal['wizard_prefill'],
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('AssistantImport', () => {
  it('renders nothing when no assistant has left a draft', async () => {
    vi.spyOn(api, 'getImportProposal').mockResolvedValue(null)
    const { container } = render(<AssistantImport />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('names the assistant and what it prepared', async () => {
    vi.spyOn(api, 'getImportProposal').mockResolvedValue(PROPOSAL)
    render(<AssistantImport />)

    expect(await screen.findByText('ChatGPT prepared an import')).toBeInTheDocument()
    expect(screen.getByText(/3 grants and 5 prices/)).toBeInTheDocument()
  })

  it('says plainly that nothing has changed yet', async () => {
    // The assistant may well have told the user it was done. This is the
    // screen that has to correct that.
    vi.spyOn(api, 'getImportProposal').mockResolvedValue(PROPOSAL)
    render(<AssistantImport />)
    expect(await screen.findByText(/Nothing has changed yet/)).toBeInTheDocument()
  })

  it('hands the draft to the wizard rather than applying it', async () => {
    vi.spyOn(api, 'getImportProposal').mockResolvedValue(PROPOSAL)
    render(<AssistantImport />)

    await userEvent.click(await screen.findByRole('button', { name: 'Review import' }))
    expect(screen.getByTestId('wizard')).toHaveTextContent('wizard with 1 grants')
  })

  it('warns when checks did not pass', async () => {
    vi.spyOn(api, 'getImportProposal').mockResolvedValue({
      ...PROPOSAL,
      blocked: true,
      findings: [{ code: 'G3', severity: 'error', subject: '2021 Purchase',
        message: 'Shares do not match the statement' }],
    })
    render(<AssistantImport />)

    expect(await screen.findByText(/Some checks did not pass/)).toBeInTheDocument()
    expect(screen.getByText('G3')).toBeInTheDocument()
  })

  it('discards the draft', async () => {
    vi.spyOn(api, 'getImportProposal').mockResolvedValue(PROPOSAL)
    const dismiss = vi.spyOn(api, 'dismissImportProposal').mockResolvedValue(undefined)
    const { container } = render(<AssistantImport />)

    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(dismiss).toHaveBeenCalled()
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('stays quiet when the proposal cannot be loaded', async () => {
    // The rest of the Import page must not depend on this.
    vi.spyOn(api, 'getImportProposal').mockRejectedValue(new Error('boom'))
    const { container } = render(<AssistantImport />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})

describe('AssistantImport — the chat path', () => {
  it('offers the chat path when nothing is waiting', async () => {
    vi.spyOn(api, 'getImportProposal').mockResolvedValue(null)
    vi.spyOn(api, 'getAiConnections').mockResolvedValue([])
    render(<MemoryRouter><AssistantImport showIntro /></MemoryRouter>)
    expect(await screen.findByText('Let ChatGPT or Claude do it')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Connect ChatGPT or Claude' }))
      .toHaveAttribute('href', '/settings#ai-connections')
  })

  it('says which assistant is ready to prepare an import', async () => {
    vi.spyOn(api, 'getImportProposal').mockResolvedValue(null)
    vi.spyOn(api, 'getAiConnections').mockResolvedValue([{
      id: 1, client_name: 'Claude', scopes: ['equity:read', 'import:propose'],
      created_at: null, last_used_at: null }])
    render(<MemoryRouter><AssistantImport showIntro /></MemoryRouter>)
    expect(await screen.findByText(/Connected: Claude/)).toBeInTheDocument()
  })

  it('puts the guesses and the changes in front of the review', async () => {
    vi.spyOn(api, 'getImportProposal').mockResolvedValue({
      ...PROPOSAL,
      assumptions: [{ subject: '2026 Purchase', note: 'Vesting copied from the 2025 grant.' }],
      changes: {
        grants_added: ['2026 Purchase: 2,000 shares'],
        loans_removed: ['2021 Purchase: interest loan of $1,000.00 (no. 222)'],
        loans_updated: ['2021 Purchase: loan no. 111 amount $300.00 → $3,000.00'],
        grants_kept: ['2021 Bonus'],
      },
    })
    render(<MemoryRouter><AssistantImport /></MemoryRouter>)
    expect(await screen.findByText('ChatGPT guessed these — check them')).toBeInTheDocument()
    expect(screen.getByText('Vesting copied from the 2025 grant.')).toBeInTheDocument()
    expect(screen.getByText('Loans that would be removed')).toBeInTheDocument()
    expect(screen.getByText('2021 Purchase: interest loan of $1,000.00 (no. 222)')).toBeInTheDocument()
    expect(screen.getByText('Loans that change')).toBeInTheDocument()
    expect(screen.getByText('2021 Purchase: loan no. 111 amount $300.00 → $3,000.00')).toBeInTheDocument()
  })
})

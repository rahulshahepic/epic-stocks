import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SalesEntryScreen } from '../app/components/importWizard/screens/SalesEntry.tsx'
import { prefillToSaleDraft, submittableSales } from '../app/components/importWizard/sales.ts'
import type { SaleDraft } from '../app/components/importWizard/types.ts'

function draft(over: Partial<SaleDraft> = {}): SaleDraft {
  return {
    shares: 10000, date: '', price_per_share: '', notes: '', ...over,
  }
}

describe('submittableSales', () => {
  it('keeps only sales with both a date and a price', () => {
    expect(submittableSales([
      draft({ date: '2024-03-01', price_per_share: '12.5' }),
      draft({ date: '2024-03-01' }),
      draft({ price_per_share: '12.5' }),
      draft(),
    ])).toEqual([
      { date: '2024-03-01', shares: 10000, price_per_share: 12.5, notes: '' },
    ])
  })

  it('drops a zero or negative price rather than importing it', () => {
    // A zero price would read as a total loss and a negative one is nonsense;
    // both would land in capital gains looking like real figures.
    expect(submittableSales([
      draft({ date: '2024-03-01', price_per_share: '0' }),
      draft({ date: '2024-03-01', price_per_share: '-5' }),
    ])).toEqual([])
  })

  it('carries the share count the import worked out, not one the user retyped', () => {
    const [sale] = submittableSales([draft({ shares: 33333, date: '2024-03-01', price_per_share: '4.1' })])
    expect(sale.shares).toBe(33333)
  })
})

describe('prefillToSaleDraft', () => {
  it('turns an unanswered sale from the import into blank fields', () => {
    expect(prefillToSaleDraft({
      shares: 10000, date: '', price_per_share: null,
      notes: 'Shares the stock workbook reports gone: 2021 Purchased (10,000).',
      needs_input: true,
    })).toEqual({
      shares: 10000, date: '', price_per_share: '',
      notes: 'Shares the stock workbook reports gone: 2021 Purchased (10,000).',
    })
  })

  it('keeps figures an assistant already collected', () => {
    expect(prefillToSaleDraft({
      shares: 500, date: '2023-06-30', price_per_share: 4.1, notes: '', needs_input: false,
    })).toMatchObject({ date: '2023-06-30', price_per_share: '4.1' })
  })
})

describe('SalesEntryScreen', () => {
  const noop = () => {}

  it('shows the share count the files reported and asks for the rest', () => {
    render(<SalesEntryScreen sales={[draft({ notes: '2021 Purchased (10,000)' })]}
      onChange={noop} onBack={noop} onNext={noop} onSkip={noop} />)

    expect(screen.getByText(/Sale 1 · 10,000 shares/)).toBeInTheDocument()
    expect(screen.getByText('2021 Purchased (10,000)')).toBeInTheDocument()
    expect(screen.getByLabelText('Date sold')).toHaveValue('')
    expect(screen.getByLabelText('Price per share')).toHaveValue(null)
  })

  it('reports an edit without holding the value itself', async () => {
    const onChange = vi.fn()
    render(<SalesEntryScreen sales={[draft()]} onChange={onChange}
      onBack={noop} onNext={noop} onSkip={noop} />)

    await userEvent.type(screen.getByLabelText('Price per share'), '4')
    expect(onChange).toHaveBeenCalledWith(0, expect.objectContaining({ price_per_share: '4' }))
  })

  it('warns when only one of the two figures is filled in', () => {
    render(<SalesEntryScreen sales={[draft({ date: '2024-03-01' })]}
      onChange={noop} onBack={noop} onNext={noop} onSkip={noop} />)

    expect(screen.getByText(/Not importing this row/)).toBeInTheDocument()
  })

  it('counts the answered sales on the button so the user knows what will be written', () => {
    render(<SalesEntryScreen
      sales={[draft({ date: '2024-03-01', price_per_share: '12.5' }), draft()]}
      onChange={noop} onBack={noop} onNext={noop} onSkip={noop} />)

    expect(screen.getByRole('button', { name: /review 1 new sale/ })).toBeInTheDocument()
  })

  it('lets the user move on without answering', async () => {
    const onSkip = vi.fn()
    render(<SalesEntryScreen sales={[draft()]} onChange={noop}
      onBack={noop} onNext={noop} onSkip={onSkip} />)

    await userEvent.click(screen.getByRole('button', { name: /Skip/ }))
    expect(onSkip).toHaveBeenCalled()
  })
})

describe('sales reconciliation', () => {
  it('lets a saved sale supply its actual date, price and quantity', async () => {
    const onChange = vi.fn()
    render(<SalesEntryScreen sales={[draft()]} existingSales={[
      { date: '2024-03-01', shares: 500, price_per_share: 12.5, notes: 'saved note' },
    ]} onChange={onChange} onBack={vi.fn()} onNext={vi.fn()} onSkip={vi.fn()} />)
    await userEvent.selectOptions(screen.getByLabelText('Use a saved sale'), '0')
    expect(onChange).toHaveBeenCalledWith(0, expect.objectContaining({
      shares: 500, date: '2024-03-01', price_per_share: '12.5', notes: 'saved note',
    }))
  })

  it('blocks a sale count that still includes corrected down-payment exchanges', () => {
    render(<SalesEntryScreen sales={[draft({ shares: 1834, date: '2024-03-01', price_per_share: '12.5' })]}
      availableShares={500} onChange={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} onSkip={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/exceed the workbook total/)
    expect(screen.getByRole('button', { name: /Next: review/ })).toBeDisabled()
  })
})

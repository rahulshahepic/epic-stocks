import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import {
  remainingSaleShares, resizeUnansweredSale, saleReview, submittableSales,
} from '../app/components/importWizard/sales.ts'
import type { SaleDraft } from '../app/components/importWizard/types.ts'
import { DoneScreen, ReviewScreen } from '../app/components/importWizard/screens/Finish.tsx'
import type { WizardGrant } from '../api.ts'

const sale: SaleDraft = { shares: 500, date: '2024-03-01', price_per_share: '12.5', notes: '' }

describe('import sales', () => {
  it('splits actual sales across years without changing prices or quantities', () => {
    const rows = [sale, { ...sale, shares: 300, date: '2025-03-01', price_per_share: '15' }]
    expect(submittableSales(rows)).toMatchObject([
      { shares: 500, date: '2024-03-01', price_per_share: 12.5 },
      { shares: 300, date: '2025-03-01', price_per_share: 15 },
    ])
    expect(saleReview(rows, [], 1000)).toMatchObject({ newCount: 2, skippedShares: 200, issues: [] })
  })

  it('matches existing identical transactions one-for-one, independent of notes', () => {
    const saved = [{ date: sale.date, shares: 500, price_per_share: 12.5, notes: 'original' }]
    expect(saleReview([sale, sale], saved, 1000)).toMatchObject({ newCount: 1, existingCount: 1 })
    expect(saleReview([sale, sale], [...saved, ...saved], 1000)).toMatchObject({ newCount: 0, existingCount: 2 })
  })

  it('recalculates exchanges only for grants covered by the workbook', () => {
    const grants = [
      { year: 2022, type: 'Purchase', dp_shares: -1334 },
      { year: 2026, type: 'Purchase', dp_shares: -900 },
    ] as WizardGrant[]
    expect(remainingSaleShares(1834, grants, ['2022:Purchase'])).toBe(500)
    const blank = { ...sale, shares: 1834, date: '', price_per_share: '' }
    expect(resizeUnansweredSale([blank], 500)[0].shares).toBe(500)
    expect(resizeUnansweredSale([sale], 100)[0].shares).toBe(500)
    expect(saleReview([sale], [], 100).issues).toHaveLength(1)
  })

  it('keeps a skipped balance visible even when every row was removed', () => {
    expect(saleReview([], [], 500)).toMatchObject({ newCount: 0, skippedShares: 500 })
  })

  it.each(['Infinity', 'NaN', '0', '-1', '1000001', '12oops'])('does not submit invalid price %s', price => {
    expect(submittableSales([{ ...sale, price_per_share: price }])).toEqual([])
  })

  it.each(['2024-02-30', 'bad-date'])('does not submit invalid date %s', date => {
    expect(submittableSales([{ ...sale, date }])).toEqual([])
  })

  it('shows both planned imports and skipped shares on Review', () => {
    const review = saleReview([sale, { ...sale, shares: 200, date: '' }], [], 1000)
    render(<ReviewScreen salesReview={review} submission={{ grants: [], prices: [], droppedLoans: [], droppedPrices: [], blockingIssues: [] }}
      submitting={false} submitError="" orphanPrices={[]} orphanGrants={[]} preservedPriceIds={new Set()}
      preservedGrantIds={new Set()} onBack={() => {}} onSubmit={() => {}} />)
    const summary = within(screen.getByRole('region', { name: 'Sales summary' }))
    expect(summary.getByText(/1 to import/)).toBeInTheDocument()
    expect(summary.getByText(/500 shares remain unimported/)).toBeInTheDocument()
    expect(summary.getByText(/200 shares — skipped/)).toBeInTheDocument()
  })

  it('uses the actual server counts on completion, including a retry match', () => {
    render(<DoneScreen grants={[]} priceCount={0} onComplete={() => {}}
      salesReview={saleReview([sale], [], 800)}
      submitResult={{ grants: 0, loans: 0, prices: 0, payoff_sales: 0, sales: 0, existing_sales: 1 }} />)
    expect(screen.getByText(/0 imported · 1 already recorded/)).toBeInTheDocument()
    expect(screen.getByText(/300 shares remain unimported/)).toBeInTheDocument()
  })
})

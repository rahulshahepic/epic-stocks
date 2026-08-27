import { describe, it, expect } from 'vitest'
import { inferRefiSteps } from '../app/refiInference.ts'

// The 2018 purchase chain as Epic ran it: three refinances, three distinct rates.
const PURCHASE_2018 = [
  { rate: 0.0169, dueDate: '2025-07-15' },
  { rate: 0.0043, dueDate: '2025-07-15' },
  { rate: 0.0086, dueDate: '2027-07-15' },
]
const ORIGINAL_2018 = { rate: 0.0307, dueDate: '2025-07-15' }

describe('inferRefiSteps', () => {
  it('applies the whole chain when there is no rate to go on', () => {
    expect(inferRefiSteps(PURCHASE_2018, ORIGINAL_2018, { rate: null }))
      .toEqual({ steps: 3, basis: 'assumed' })
    expect(inferRefiSteps(PURCHASE_2018, ORIGINAL_2018, { rate: NaN }))
      .toEqual({ steps: 3, basis: 'assumed' })
    expect(inferRefiSteps(PURCHASE_2018, ORIGINAL_2018, { rate: 0 }))
      .toEqual({ steps: 3, basis: 'assumed' })
  })

  it('reads the last step from the rate on the statement', () => {
    expect(inferRefiSteps(PURCHASE_2018, ORIGINAL_2018, { rate: 0.0086, dueDate: '2027-07-15' }))
      .toEqual({ steps: 3, basis: 'rate' })
  })

  it('stops partway when the rate is a middle step', () => {
    expect(inferRefiSteps(PURCHASE_2018, ORIGINAL_2018, { rate: 0.0169 }))
      .toEqual({ steps: 1, basis: 'rate' })
    expect(inferRefiSteps(PURCHASE_2018, ORIGINAL_2018, { rate: 0.0043 }))
      .toEqual({ steps: 2, basis: 'rate' })
  })

  it('applies nothing when the loan is still on its original rate', () => {
    expect(inferRefiSteps(PURCHASE_2018, ORIGINAL_2018, { rate: 0.0307, dueDate: '2025-07-15' }))
      .toEqual({ steps: 0, basis: 'original' })
  })

  it('applies nothing when the rate matches no step at all, and says so', () => {
    expect(inferRefiSteps(PURCHASE_2018, ORIGINAL_2018, { rate: 0.0123 }))
      .toEqual({ steps: 0, basis: 'unmatched' })
  })

  it('has no chain to apply when the grant year has none', () => {
    expect(inferRefiSteps(undefined, { rate: 0.0086, dueDate: '2030-07-15' }, { rate: 0.0086 }))
      .toEqual({ steps: 0, basis: 'original' })
    expect(inferRefiSteps([], ORIGINAL_2018, { rate: 0.0086 }))
      .toEqual({ steps: 0, basis: 'original' })
  })

  it('separates a refinance from the original by due date when they share a rate', () => {
    // The 2020 Bonus tax chain refinanced at the rate the loan already carried;
    // only the due date moved.
    const chain = [{ rate: 0.0086, dueDate: '2029-07-15' }]
    const original = { rate: 0.0086, dueDate: '2024-07-15' }
    expect(inferRefiSteps(chain, original, { rate: 0.0086, dueDate: '2029-07-15' }))
      .toEqual({ steps: 1, basis: 'due-date' })
    expect(inferRefiSteps(chain, original, { rate: 0.0086, dueDate: '2024-07-15' }))
      .toEqual({ steps: 0, basis: 'original' })
    // No due date to go on: a rate that matches a step means it was refinanced.
    expect(inferRefiSteps(chain, original, { rate: 0.0086 }))
      .toEqual({ steps: 1, basis: 'rate' })
  })

  it('picks the later of two steps that share a rate, by due date', () => {
    const chain = [
      { rate: 0.0043, dueDate: '2025-07-15' },
      { rate: 0.0043, dueDate: '2027-07-15' },
    ]
    expect(inferRefiSteps(chain, ORIGINAL_2018, { rate: 0.0043, dueDate: '2025-07-15' }))
      .toEqual({ steps: 1, basis: 'due-date' })
    expect(inferRefiSteps(chain, ORIGINAL_2018, { rate: 0.0043, dueDate: '2027-07-15' }))
      .toEqual({ steps: 2, basis: 'due-date' })
    // An unrecognised due date falls back to the latest step the rate can be.
    expect(inferRefiSteps(chain, ORIGINAL_2018, { rate: 0.0043, dueDate: '2026-01-01' }))
      .toEqual({ steps: 2, basis: 'rate' })
  })

  it('matches rates that differ only below the precision Epic prints', () => {
    expect(inferRefiSteps(PURCHASE_2018, ORIGINAL_2018, { rate: 0.0086 + 1e-9 }))
      .toEqual({ steps: 3, basis: 'rate' })
    expect(inferRefiSteps(PURCHASE_2018, ORIGINAL_2018, { rate: 0.0087 }))
      .toEqual({ steps: 0, basis: 'unmatched' })
  })
})

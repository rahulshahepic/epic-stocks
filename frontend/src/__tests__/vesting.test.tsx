import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Grants from '../app/pages/Grants.tsx'
import { equalParts, scheduleProblem, vestedBy, vestingOf } from '../app/vesting.ts'

describe('vesting helpers', () => {
  it('splits like the server: each part rounded down, the rest last', () => {
    expect(equalParts(1001, '2027-09-30', 4).map(r => r.shares)).toEqual([250, 250, 250, 251])
    expect(equalParts(1001, '2027-09-30', 4).map(r => r.date)).toEqual(
      ['2027-09-30', '2028-09-30', '2029-09-30', '2030-09-30'])
  })

  it('reads stored rows as they are, moved dates included', () => {
    const g = { shares: 10, vest_start: '2025-01-01', periods: 2,
      vesting: [{ date: '2025-01-01', shares: 3 }, { date: '2026-07-15', shares: 7 }] }
    expect(vestingOf(g)).toBe(g.vesting)
    expect(vestedBy(g, '2026-07-14')).toBe(3)
    expect(vestedBy(g, '2026-07-15')).toBe(10)
  })

  it('says what is wrong with a schedule', () => {
    expect(scheduleProblem([{ date: '2025-01-01', shares: 5 }], 10)).toMatch(/add up to 5/)
    expect(scheduleProblem([{ date: '2025-01-01', shares: 5 }, { date: '2025-01-01', shares: 5 }], 10))
      .toMatch(/same day/)
    expect(scheduleProblem([{ date: '2025-01-01', shares: 10 }], 10)).toBeNull()
  })
})

const GRANT = {
  id: 2, version: 3, year: 2022, type: 'Bonus', shares: 1000, price: 0,
  vest_start: '2023-03-01', periods: 2, exercise_date: '2022-12-31', dp_shares: 0, election_83b: false,
  vesting: [{ date: '2023-03-01', shares: 500 }, { date: '2024-03-01', shares: 500 }],
}

describe('editing a grant', () => {
  let puts: Record<string, unknown>[] = []
  beforeEach(() => {
    vi.restoreAllMocks()
    puts = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      const method = init?.method ?? 'GET'
      if (url.match(/\/api\/grants\/2$/) && method === 'PUT') {
        puts.push(JSON.parse(String(init?.body)))
        return new Response(JSON.stringify(GRANT), { status: 200 })
      }
      if (url.includes('/api/grants') && method === 'GET') return new Response(JSON.stringify([GRANT]), { status: 200 })
      if (url.includes('/api/config')) return new Response('{}', { status: 200 })
      return new Response('[]', { status: 200 })
    })
  })

  async function openEdit() {
    render(<MemoryRouter><Grants /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('Edit').length).toBeGreaterThan(0))
    await userEvent.click(screen.getAllByText('Edit')[0])
  }

  it('sends a moved date as the schedule', async () => {
    await openEdit()
    const second = screen.getByLabelText('Vesting date 2')
    await userEvent.clear(second)
    await userEvent.type(second, '2024-09-15')
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].vesting).toEqual([{ date: '2023-03-01', shares: 500 }, { date: '2024-09-15', shares: 500 }])
    expect(puts[0]).not.toHaveProperty('vest_start')
    expect(puts[0]).not.toHaveProperty('periods')
  })

  it('leaves the schedule out when it was not edited, so a leave is not undone', async () => {
    await openEdit()
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).not.toHaveProperty('vesting')
    expect(puts[0]).not.toHaveProperty('vest_start')
    expect(puts[0].version).toBe(3)
  })
})

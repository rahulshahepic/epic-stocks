import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Demo from '../app/pages/Demo.tsx'
import { loadDemo, type DemoData, type DemoProfile } from '../app/demo.ts'

vi.mock('../app/demo.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../app/demo.ts')>()),
  loadDemo: vi.fn()
}))
vi.mock('../app/components/ExitBreakdownCard.tsx', () => ({ default: () => <p>Exit breakdown</p> }))
vi.mock('../app/pages/dashboard/ShareCards.tsx', () => ({
  ShareCards: () => <p>Share cards</p>
}))
vi.mock('../app/pages/dashboard/EarningsCards.tsx', () => ({
  EarningsCards: () => <p>Earnings cards</p>
}))
vi.mock('../app/pages/dashboard/CostCards.tsx', () => ({
  CostCards: () => <p>Cost cards</p>
}))

function result(profile: DemoProfile): DemoData {
  return {
    fictional: true,
    profile,
    as_of: '2026-11-24',
    assumptions: 'Invented fixtures',
    profiles: {
      early: { label: 'Early career', age: 28, other_assets_m: 0.05 },
      established: { label: 'Established', age: 38, other_assets_m: 0.4 },
      exit: { label: 'Planning an exit', age: 50, other_assets_m: 1.2 }
    },
    dashboard: {
      cards: {
        total_shares: 1000,
        unvested_shares: 100,
        total_stock_value: 10000
      }
    },
    events: [],
    exit: null,
    sale: null
  } as unknown as DemoData
}
function show() {
  return render(
    <MemoryRouter>
      <Demo />
    </MemoryRouter>
  )
}
beforeEach(() => {
  vi.mocked(loadDemo).mockReset()
  vi.mocked(loadDemo).mockImplementation(async (p) => result(p))
  sessionStorage.clear()
})

describe('anonymous demo', () => {
  it('opens without authentication and never creates a signup draft', async () => {
    const store = vi.spyOn(Storage.prototype, 'setItem')
    show()
    expect(await screen.findByText('Share cards')).toBeInTheDocument()
    expect(
      screen.getByText('Interactive demo · fictional data')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Use my own files/ })
    ).toHaveAttribute('href', '/try')
    expect(store).not.toHaveBeenCalled()
    store.mockRestore()
  })
  it('discards late responses when changing profiles', async () => {
    let release!: (v: DemoData) => void
    vi.mocked(loadDemo).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      })
    )
    show()
    fireEvent.click(screen.getByRole('button', { name: /Planning an exit/ }))
    expect(await screen.findByText('Share cards')).toBeInTheDocument()
    release(result('early'))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Planning an exit/ })
      ).toHaveAttribute('aria-pressed', 'true')
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retirement' }))
    expect(screen.getByText(/\$1,200,000/)).toBeInTheDocument()
  })
  it('shows failed requests and retries without stale cards', async () => {
    vi.mocked(loadDemo).mockRejectedValueOnce(
      new Error('Demo temporarily busy')
    )
    show()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Demo temporarily busy'
    )
    expect(screen.queryByText('Share cards')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Share cards')).toBeInTheDocument()
  })
  it('quotes a sale then resets the profile, date and quote', async () => {
    show()
    await screen.findByText('Share cards')
    fireEvent.click(screen.getByRole('button', { name: 'Sale what-if' }))
    expect(screen.getByLabelText('Shares to sell')).toHaveAttribute('max', '1000')
    fireEvent.change(screen.getByLabelText('Shares to sell'), {
      target: { value: '12' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Estimate sale' }))
    await waitFor(() =>
      expect(loadDemo).toHaveBeenLastCalledWith(
        'established',
        '2026-11-24',
        expect.any(AbortSignal),
        12
      )
    )
    await screen.findByLabelText('Shares to sell')
    fireEvent.click(screen.getByRole('button', { name: 'Reset demo' }))
    await waitFor(() =>
      expect(loadDemo).toHaveBeenLastCalledWith(
        'established',
        '2026-11-24',
        expect.any(AbortSignal),
        undefined
      )
    )
    expect(await screen.findByText('Share cards')).toBeInTheDocument()
  })
})


it('does not simulate retirement while the modeled exit has an unfunded shortfall', async () => {
  const data = result('early')
  data.exit = { net_cash: 0, liquidation_shortfall: 5000 } as DemoData['exit']
  vi.mocked(loadDemo).mockResolvedValue(data)
  show()
  await screen.findByText('Share cards')
  fireEvent.click(screen.getByRole('button', { name: 'Retirement' }))
  expect(screen.getByRole('button', { name: 'Run simulation' })).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('exit shortfall')
})

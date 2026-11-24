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
    expect(await screen.findByText(/\$1,200,000/)).toBeInTheDocument()
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
  expect(await screen.findByRole('button', { name: 'Run simulation' })).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('exit shortfall')
})


it('uses a separate future retirement date and ignores cleared or out-of-range dates', async () => {
  show()
  await screen.findByText('Share cards')
  fireEvent.change(screen.getByLabelText('Explore as of'), {target: {value: ''}})
  expect(screen.getByLabelText('Explore as of')).toHaveValue('2026-11-24')
  fireEvent.click(screen.getByRole('button', {name: 'Retirement'}))
  expect(await screen.findByRole('button', {name: 'Run simulation'})).toBeVisible()
  expect(screen.getByLabelText('Retirement date')).toHaveValue('2032-01-01')
  expect(loadDemo).toHaveBeenLastCalledWith('established', '2032-01-01', expect.any(AbortSignal), undefined)
  fireEvent.change(screen.getByLabelText('Retirement date'), {target: {value: '2035-01-01'}})
  await waitFor(() => expect(loadDemo).toHaveBeenLastCalledWith('established', '2035-01-01', expect.any(AbortSignal), undefined))
  await screen.findByRole('button', {name: 'Run simulation'})
  fireEvent.change(screen.getByLabelText('Retirement date'), {target: {value: '2050-01-01'}})
  expect(screen.getByLabelText('Retirement date')).toHaveValue('2035-01-01')
  fireEvent.click(screen.getByRole('button', {name: 'Overview'}))
  await screen.findByText('Share cards')
  expect(screen.getByLabelText('Explore as of')).toHaveValue('2026-11-24')
})


it('reloads when overview and retirement dates happen to match', async () => {
  show()
  await screen.findByText('Share cards')
  fireEvent.change(screen.getByLabelText('Explore as of'), {target: {value: '2032-01-01'}})
  await screen.findByText('Share cards')
  fireEvent.click(screen.getByRole('button', {name: 'Retirement'}))
  expect(await screen.findByRole('button', {name: 'Run simulation'})).toBeVisible()
  fireEvent.click(screen.getByRole('button', {name: 'Overview'}))
  expect(await screen.findByText('Share cards')).toBeVisible()
})


it('sends the retirement date, age and dated exit to the worker together', async () => {
  const post = vi.fn()
  const terminate = vi.fn()
  vi.stubGlobal('Worker', class { postMessage = post; terminate = terminate })
  const data = result('established')
  data.exit = {net_cash: 1_000_000, liquidation_shortfall: 0} as DemoData['exit']
  vi.mocked(loadDemo).mockResolvedValue(data)
  try {
    show()
    await screen.findByText('Share cards')
    fireEvent.click(screen.getByRole('button', {name: 'Retirement'}))
    fireEvent.click(await screen.findByRole('button', {name: 'Run simulation'}))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({simulationStartDate: '2032-01-01', currentAge: 44, epicExit: 1}))
  } finally { vi.unstubAllGlobals() }
})


it('does not send an overview sale quote into the retirement projection', async () => {
  show()
  await screen.findByText('Share cards')
  fireEvent.click(screen.getByRole('button', {name: 'Sale what-if'}))
  fireEvent.change(screen.getByLabelText('Shares to sell'), {target: {value: '1000'}})
  fireEvent.click(screen.getByRole('button', {name: 'Estimate sale'}))
  await waitFor(() => expect(loadDemo).toHaveBeenLastCalledWith('established', '2026-11-24', expect.any(AbortSignal), 1000))
  await screen.findByLabelText('Shares to sell')
  fireEvent.click(screen.getByRole('button', {name: 'Retirement'}))
  await screen.findByRole('button', {name: 'Run simulation'})
  expect(loadDemo).toHaveBeenLastCalledWith('established', '2032-01-01', expect.any(AbortSignal), undefined)
})

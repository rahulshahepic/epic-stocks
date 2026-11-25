import { afterEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AnnualStockSummary from '../app/components/AnnualStockSummary.tsx'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('uses the completed server year when the browser calendar disagrees', async () => {
  vi.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2027)
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    year: 2025, note: 'Completed server year', price_is_estimate: false, rows: [],
  }), { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
  render(<AnnualStockSummary openFromLink />)
  expect(await screen.findByText('Completed server year')).toBeInTheDocument()
  expect(screen.getByText('Your 2025 stock summary')).toBeInTheDocument()
  expect(String(fetcher.mock.calls[0][0])).toMatch(/\/api\/annual-stock-summary$/)
})

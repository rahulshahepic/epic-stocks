import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { api, type ChangeResult } from '../api.ts'
import AnnouncedPrice from '../app/components/AnnouncedPrice.tsx'

const result: ChangeResult = { applied: false, changes: [], position_before: { net_equity: 100 }, position_after: { net_equity: 200 }, confirm: 'fictional-confirm' }
beforeEach(() => vi.restoreAllMocks())

it('locks the typed price while checking and preserves a recorded announcement date', async () => {
  const year = new Date().getFullYear()
  let resolve!: (rows: Awaited<ReturnType<typeof api.getPrices>>) => void
  vi.spyOn(api, 'getPrices').mockImplementation(() => new Promise(r => { resolve = r }))
  const preview = vi.spyOn(api, 'previewChanges').mockResolvedValue(result)
  render(<MemoryRouter><AnnouncedPrice /></MemoryRouter>)
  await userEvent.type(screen.getByLabelText('Announced price'), '42')
  await userEvent.click(screen.getByRole('button', {name: 'See what changes'}))
  expect(screen.getByLabelText('Announced price')).toBeDisabled()
  resolve([{id: 1, version: 7, effective_date: `${year}-01-01`, price: 20, is_estimate: false, announced_date: `${year}-01-01`}])
  await screen.findByRole('button', {name: 'Save confirmed price'})
  expect(preview).toHaveBeenCalledWith([expect.objectContaining({action: 'update', id: 1, version: 7,
    values: expect.objectContaining({price: 42, is_estimate: false, announced_date: `${year}-01-01`})})])
  expect(screen.getByText(/Confirmed price: \$42.00/)).toBeVisible()
})

it('invalidates confirmation when the price changes and keeps the saved result', async () => {
  vi.spyOn(api, 'getPrices').mockResolvedValue([])
  vi.spyOn(api, 'previewChanges').mockResolvedValue(result)
  const apply = vi.spyOn(api, 'applyChanges').mockResolvedValue({...result, applied: true})
  vi.spyOn(api, 'getDashboardSnapshot').mockResolvedValue({summary_sentences: ['Your fictional position is updated.']} as Awaited<ReturnType<typeof api.getDashboardSnapshot>>)
  const onSaved = vi.fn()
  render(<MemoryRouter><AnnouncedPrice onSaved={onSaved} /></MemoryRouter>)
  const input = screen.getByLabelText('Announced price')
  await userEvent.type(input, '20')
  await userEvent.click(screen.getByRole('button', {name: 'See what changes'}))
  await screen.findByRole('button', {name: 'Save confirmed price'})
  await userEvent.clear(input)
  await userEvent.type(input, '30')
  expect(screen.queryByRole('button', {name: 'Save confirmed price'})).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', {name: 'See what changes'}))
  await userEvent.click(await screen.findByRole('button', {name: 'Save confirmed price'}))
  expect(await screen.findByText('Your fictional position is updated.')).toBeVisible()
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  expect(apply).toHaveBeenCalledWith([expect.objectContaining({values: expect.objectContaining({price: 30})})], 'fictional-confirm')
})

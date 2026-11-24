import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import StagingSeedPanel from '../app/components/StagingSeedPanel.tsx'
import { apiFetchRaw } from '../api.ts'
vi.mock('../api.ts', () => ({ apiFetchRaw: vi.fn() }))
beforeEach(() => vi.mocked(apiFetchRaw).mockReset())
it('loads a named fictional profile into the signed-in account', async () => {
  const onSeeded = vi.fn()
  vi.mocked(apiFetchRaw).mockResolvedValue(new Response('{}', { status: 200 }))
  render(<StagingSeedPanel onSeeded={onSeeded} />)
  fireEvent.click(screen.getByRole('button', { name: /Load Early career/ }))
  await vi.waitFor(() => expect(onSeeded).toHaveBeenCalledOnce())
  expect(apiFetchRaw).toHaveBeenCalledWith('/api/demo/seed', { method: 'POST', body: '{"profile":"early"}' })
})
it('shows a refusal to replace existing records and allows retry', async () => {
  vi.mocked(apiFetchRaw).mockResolvedValue(new Response(JSON.stringify({ detail: 'Existing records will not be replaced.' }), { status: 409 }))
  const onSeeded = vi.fn()
  render(<StagingSeedPanel onSeeded={onSeeded} />)
  fireEvent.click(screen.getByRole('button', { name: /Load Established/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Existing records will not be replaced.')
  expect(onSeeded).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: /Load Early career/ })).toBeEnabled()
})

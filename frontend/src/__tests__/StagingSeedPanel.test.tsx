import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import StagingSeedPanel from '../app/components/StagingSeedPanel.tsx'
import { apiFetchRaw } from '../api.ts'
import { getClientLog, getLastErrorRef, resetReportLog } from '../scaffold/reportLog.ts'
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

it('keeps a safe failure trail and server reference for refused setup', async () => {
  resetReportLog()
  vi.mocked(apiFetchRaw).mockResolvedValue(new Response(JSON.stringify({ detail: 'Existing records will not be replaced.' }), {
    status: 409,
    headers: { 'X-Error-Ref': 'abcdef12' }
  }))
  render(<StagingSeedPanel onSeeded={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /Load Established/ }))
  await screen.findByRole('alert')
  expect(getClientLog()).toContain('POST /api/demo/seed → 409 [ref abcdef12]')
  expect(getClientLog()).not.toContain('Existing records')
  expect(getLastErrorRef()).toBe('abcdef12')
})
it('requires a separate click to confirm a fictional workspace reset', async () => {
  const onSeeded = vi.fn()
  vi.mocked(apiFetchRaw)
    .mockResolvedValueOnce(new Response(JSON.stringify({ detail: { code: 'reset_required', confirm: 'fixture-token' } }), { status: 409 }))
    .mockResolvedValueOnce(new Response('{}', { status: 200 }))
  render(<StagingSeedPanel currentScenario="early" onSeeded={onSeeded} />)
  fireEvent.click(screen.getByRole('button', { name: /Load Established/ }))
  await screen.findByRole('button', { name: 'Reset fictional workspace' })
  expect(onSeeded).not.toHaveBeenCalled()
  expect(apiFetchRaw).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Reset fictional workspace' }))
  await vi.waitFor(() => expect(onSeeded).toHaveBeenCalledOnce())
  expect(apiFetchRaw).toHaveBeenLastCalledWith('/api/demo/seed', { method: 'POST', body: '{"profile":"established","confirm":"fixture-token","reset":true}' })
})
it('keeps testing edits when reset is cancelled', async () => {
  vi.mocked(apiFetchRaw).mockResolvedValueOnce(new Response(JSON.stringify({ detail: { code: 'reset_required', confirm: 'fixture-token' } }), { status: 409 }))
  render(<StagingSeedPanel currentScenario="early" onSeeded={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Reset current fictional profile' }))
  await screen.findByRole('button', { name: 'Keep testing edits' })
  fireEvent.click(screen.getByRole('button', { name: 'Keep testing edits' }))
  expect(screen.queryByRole('button', { name: 'Reset fictional workspace' })).not.toBeInTheDocument()
  expect(apiFetchRaw).toHaveBeenCalledTimes(1)
})

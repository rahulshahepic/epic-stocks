import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TestUsers } from '../scaffold/pages/admin/TestUsers.tsx'

const ROW = {
  id: 3, login: 'test-abc123', label: 'Audit validation', scenario: 'established',
  status: 'active', expires_at: '2027-01-01T00:00:00+00:00',
}

let calls: { url: string; method: string; body?: string }[]

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
  calls = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined })
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/api/admin/test-users/access')) {
      return json({ ...ROW, password: 'one-time-secret-value', notice: 'Copy now.' })
    }
    if (url.includes('/api/admin/test-users/3/manage')) {
      const body = JSON.parse((init?.body as string) ?? '{}')
      return json(body.confirm
        ? { applied: true, id: 3, action: body.action }
        : { applied: false, test_user: ROW, confirm: 'confirm-token', warning: 'preview' })
    }
    if (url.includes('/api/admin/test-users')) return json([ROW])
    return json({})
  })
})

describe('Internal test users admin section', () => {
  it('lists provisioned test users stamped as internal test accounts', async () => {
    render(<TestUsers />)
    await userEvent.click(screen.getByRole('button', { name: 'Load test users' }))
    expect(await screen.findByText('test-abc123')).toBeTruthy()
    expect(screen.getByText(/INTERNAL TEST · Audit validation · established · active/)).toBeTruthy()
  })

  it('provisions with a purpose label and shows the password exactly once', async () => {
    render(<TestUsers />)
    await userEvent.type(screen.getByLabelText('Test user purpose label'), 'Release check')
    await userEvent.click(screen.getByRole('button', { name: 'Provision test user' }))
    const access = calls.find(c => c.url.includes('/api/admin/test-users/access'))
    expect(access).toBeTruthy()
    expect(JSON.parse(access!.body!)).toMatchObject({ label: 'Release check', scenario: 'established' })
    const secret = await screen.findByDisplayValue('one-time-secret-value')
    expect(secret).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Hide credential' }))
    await waitFor(() => expect(screen.queryByDisplayValue('one-time-secret-value')).toBeNull())
  })

  it('requires the confirm step before revoking', async () => {
    render(<TestUsers />)
    await userEvent.click(screen.getByRole('button', { name: 'Load test users' }))
    await screen.findByText('test-abc123')
    await userEvent.click(screen.getByRole('button', { name: 'revoke' }))
    expect(await screen.findByText(/Confirm revoke of test-abc123/)).toBeTruthy()
    const manageCalls = () => calls.filter(c => c.url.includes('/manage'))
    expect(manageCalls()).toHaveLength(1)
    expect(JSON.parse(manageCalls()[0].body!)).toEqual({ action: 'revoke' })
    await userEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }))
    await waitFor(() => expect(manageCalls()).toHaveLength(2))
    expect(JSON.parse(manageCalls()[1].body!)).toEqual({ action: 'revoke', confirm: 'confirm-token' })
  })
})

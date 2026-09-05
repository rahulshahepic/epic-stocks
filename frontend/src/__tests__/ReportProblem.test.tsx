import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ReportDialog, ReportProvider, ReportProblemLink } from '../scaffold/components/ReportProblem.tsx'
import ErrorBoundary from '../scaffold/components/ErrorBoundary.tsx'
import { logApiFailure, noteErrorRef, resetReportLog } from '../scaffold/reportLog.ts'

function lastReportBody(spy: ReturnType<typeof vi.spyOn>) {
  const call = spy.mock.calls.find(([url]) =>
    String(typeof url === 'string' ? url : (url as Request).url).includes('/api/report'))
  if (!call) throw new Error('no report was sent')
  return JSON.parse(String((call[1] as RequestInit).body))
}

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetReportLog()
  Object.defineProperty(document, 'cookie', { value: '', configurable: true })
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ id: 1, error_ref: null }), { status: 200 })
  )
})

afterEach(() => { vi.restoreAllMocks() })

describe('the report dialog', () => {
  it('will not send an empty message', async () => {
    render(<ReportDialog onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tell us what went wrong')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends nothing identifying while the details box is unticked', async () => {
    logApiFailure('GET', '/api/events', 500)
    render(<ReportDialog onClose={() => {}} />)

    await userEvent.type(screen.getByPlaceholderText(/What were you doing/), 'blank dashboard')
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const body = lastReportBody(fetchSpy)
    expect(body.message).toBe('blank dashboard')
    expect(body.include_details).toBe(false)
    expect(body.user_agent).toBeNull()
    expect(body.client_log).toBeNull()
  })

  it('attaches the browser and the trail once the box is ticked', async () => {
    logApiFailure('GET', '/api/events', 500)
    render(<ReportDialog onClose={() => {}} />)

    await userEvent.type(screen.getByPlaceholderText(/What were you doing/), 'blank dashboard')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const body = lastReportBody(fetchSpy)
    expect(body.include_details).toBe(true)
    expect(body.user_agent).toBeTruthy()
    expect(body.client_log).toContain('/api/events → 500')
  })

  it('starts with the details box unticked, and says the report is anonymous', () => {
    render(<ReportDialog onClose={() => {}} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByText('This report is anonymous.')).toBeInTheDocument()
  })

  it('says so once the report will identify you', async () => {
    render(<ReportDialog onClose={() => {}} />)
    await userEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByText('This report will identify you.')).toBeInTheDocument()
  })

  it('carries the last server error ref without being asked', async () => {
    noteErrorRef('a1b2c3d4')
    render(<ReportDialog onClose={() => {}} />)

    expect(screen.getByText(/a1b2c3d4/)).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText(/What were you doing/), 'it broke')
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(lastReportBody(fetchSpy).error_ref).toBe('a1b2c3d4')
  })

  it('takes an email from someone who is not signed in', async () => {
    render(<ReportDialog onClose={() => {}} />)
    await userEvent.type(screen.getByPlaceholderText(/What were you doing/), 'cannot sign in')
    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'me@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(lastReportBody(fetchSpy).email).toBe('me@example.com')
  })

  it('shows the payload before it is sent, and says what is left out', async () => {
    render(<ReportDialog onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /Show what gets sent/ }))
    expect(screen.getByText(/account, browser and recent activity: not included/)).toBeInTheDocument()
  })

  it('confirms with a reference once it lands', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: 7, error_ref: 'deadbeef' }), { status: 200 })
    )
    render(<ReportDialog onClose={() => {}} />)
    await userEvent.type(screen.getByPlaceholderText(/What were you doing/), 'broken')
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))

    expect(await screen.findByText(/went straight to the maintainer/)).toBeInTheDocument()
    expect(screen.getByText('deadbeef')).toBeInTheDocument()
  })

  it('keeps the form open when sending fails', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ detail: 'nope' }), { status: 500 }))
    render(<ReportDialog onClose={() => {}} />)
    await userEvent.type(screen.getByPlaceholderText(/What were you doing/), 'broken')
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('nope')
    expect(screen.getByRole('button', { name: 'Send report' })).toBeInTheDocument()
  })
})

describe('the link', () => {
  it('opens the dialog from anywhere inside the provider', async () => {
    render(
      <MemoryRouter>
        <ReportProvider><ReportProblemLink /></ReportProvider>
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Report a problem' }))
    expect(await screen.findByRole('dialog', { name: 'Report a problem' })).toBeInTheDocument()
  })
})

describe('the crash screen', () => {
  function Boom(): React.ReactElement { throw new Error('render exploded') }

  it('replaces the white screen and offers a report', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><Boom /></ErrorBoundary>)

    expect(screen.getByText('Something broke on this page.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Report this' }))

    await userEvent.type(screen.getByPlaceholderText(/What were you doing/), 'clicked events')
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const body = lastReportBody(fetchSpy)
    expect(body.source).toBe('crash')
    expect(body.error_message).toContain('render exploded')
    quiet.mockRestore()
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider, useToast } from '../scaffold/components/Toast.tsx'
import { ReportProvider, ReportableError } from '../scaffold/components/ReportProblem.tsx'
import { ReportFindingsButton, summariseFindings } from '../app/components/FindingList.tsx'
import type { Finding } from '../app/epicImport.ts'

beforeEach(() => {
  Object.defineProperty(document, 'cookie', { value: '', configurable: true })
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ id: 1, error_ref: null }), { status: 200 })
  )
})

afterEach(() => { vi.restoreAllMocks() })

function Thrower() {
  const { toast } = useToast()
  return <button onClick={() => toast('Failed to load events')}>break it</button>
}

describe('error toasts', () => {
  it('offer a report, prefilled with what the toast said', async () => {
    render(
      <MemoryRouter>
        <ReportProvider><ToastProvider><Thrower /></ToastProvider></ReportProvider>
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('button', { name: 'break it' }))
    await userEvent.click(screen.getByRole('button', { name: 'Report' }))

    expect(await screen.findByRole('dialog', { name: 'Report a problem' })).toBeInTheDocument()
    expect(screen.getByText(/Failed to load events/)).toBeInTheDocument()
  })

  it('leaves success toasts alone', async () => {
    function Ok() {
      const { toast } = useToast()
      return <button onClick={() => toast('Saved', 'success')}>save</button>
    }
    render(
      <MemoryRouter>
        <ReportProvider><ToastProvider><Ok /></ToastProvider></ReportProvider>
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('button', { name: 'save' }))
    expect(screen.queryByRole('button', { name: 'Report' })).not.toBeInTheDocument()
  })
})

describe('import findings', () => {
  const findings: Finding[] = [
    { code: 'C1', severity: 'error', subject: 'statement', message: 'Balance is off by $12,345.67' },
    { code: 'G3', severity: 'warning', subject: '2021 RSU', message: '1,234 shares unaccounted for' },
    { code: 'G3', severity: 'warning', subject: '2022 RSU', message: '500 shares unaccounted for' },
  ]

  it('summarises to rule ids and counts, never the figures in the messages', () => {
    const summary = summariseFindings(findings, true)
    expect(summary).toBe('blocked import: C1(error), G3(warning) ×2')
    expect(summary).not.toContain('12,345')
    expect(summary).not.toContain('1,234')
  })

  it('sends only that summary when the button is used', async () => {
    render(
      <MemoryRouter>
        <ReportProvider><ReportFindingsButton findings={findings} /></ReportProvider>
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Report this import problem' }))
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))

    const call = vi.mocked(globalThis.fetch).mock.calls.find(([url]) =>
      String(url).includes('/api/report'))
    const body = JSON.parse(String((call![1] as RequestInit).body))
    expect(body.source).toBe('import')
    expect(body.error_message).toBe('import findings: C1(error), G3(warning) ×2')
    expect(JSON.stringify(body)).not.toContain('12,345')
  })
})


describe('an inline error message', () => {
  it('carries the failure text into the report', async () => {
    render(
      <MemoryRouter>
        <ReportProvider>
          <ReportableError message="Could not read those files" source="import" />
        </ReportProvider>
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Report this' }))
    await userEvent.type(screen.getByPlaceholderText(/What were you doing/), 'uploaded my statement')
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))

    const call = vi.mocked(globalThis.fetch).mock.calls.find(([url]) =>
      String(url).includes('/api/report'))
    const body = JSON.parse(String((call![1] as RequestInit).body))
    expect(body.source).toBe('import')
    expect(body.error_message).toBe('Could not read those files')
  })

  it('renders nothing when there is no error', () => {
    const { container } = render(
      <MemoryRouter><ReportProvider><ReportableError message="" /></ReportProvider></MemoryRouter>
    )
    expect(container).not.toHaveTextContent('Report this')
  })
})

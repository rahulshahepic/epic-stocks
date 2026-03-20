import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ImportExport from '../pages/ImportExport.tsx'

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
})

function renderPage() {
  return render(<MemoryRouter><ImportExport /></MemoryRouter>)
}

describe('ImportExport', () => {
  it('renders import and export sections', () => {
    renderPage()
    expect(screen.getByText('Import / Export')).toBeInTheDocument()
    expect(screen.getByText('Import from Excel')).toBeInTheDocument()
    expect(screen.getByText('Export to Excel')).toBeInTheDocument()
    expect(screen.getByText('Download Vesting.xlsx')).toBeInTheDocument()
  })

  it('shows confirmation dialog after file selection', async () => {
    renderPage()
    const input = screen.getByAcceptingUpload()
    const file = new File(['test'], 'Vesting.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await userEvent.upload(input, file)

    expect(screen.getByText(/This will replace all your existing/)).toBeInTheDocument()
    expect(screen.getByText('Replace All Data')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('cancel clears confirmation', async () => {
    renderPage()
    const input = screen.getByAcceptingUpload()
    const file = new File(['test'], 'Vesting.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await userEvent.upload(input, file)

    await userEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Replace All Data')).not.toBeInTheDocument()
  })

  it('shows success message after import', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ grants: 12, loans: 21, prices: 8 }), { status: 201 })
    )
    renderPage()
    const input = screen.getByAcceptingUpload()
    const file = new File(['test'], 'Vesting.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await userEvent.upload(input, file)
    await userEvent.click(screen.getByText('Replace All Data'))

    await waitFor(() => {
      expect(screen.getByText(/Import complete: 12 grants, 21 loans, 8 prices/)).toBeInTheDocument()
    })
  })

  it('shows error message on import failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Bad file format' }), { status: 400 })
    )
    renderPage()
    const input = screen.getByAcceptingUpload()
    const file = new File(['test'], 'Vesting.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await userEvent.upload(input, file)
    await userEvent.click(screen.getByText('Replace All Data'))

    await waitFor(() => {
      expect(screen.getByText('Bad file format')).toBeInTheDocument()
    })
  })

  it('export triggers download', async () => {
    const mockBlob = new Blob(['xlsx-data'])
    const mockResponse = {
      ok: true,
      status: 200,
      blob: () => Promise.resolve(mockBlob),
    } as unknown as Response
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)
    const createObjectURL = vi.fn(() => 'blob:test')
    const revokeObjectURL = vi.fn()
    globalThis.URL.createObjectURL = createObjectURL
    globalThis.URL.revokeObjectURL = revokeObjectURL

    renderPage()
    await userEvent.click(screen.getByText('Download Vesting.xlsx'))

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled()
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test')
    })
  })

  it('shows error on export failure', async () => {
    const mockResponse = { ok: false, status: 500 } as unknown as Response
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    renderPage()
    await userEvent.click(screen.getByText('Download Vesting.xlsx'))

    await waitFor(() => {
      expect(screen.getByText('Export failed (500)')).toBeInTheDocument()
    })
  })
})

// Helper to find file input by accept attribute
declare module '@testing-library/react' {
  interface Screen {
    getByAcceptingUpload(): HTMLInputElement
  }
}

screen.getByAcceptingUpload = () => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  if (!input) throw new Error('No file input found')
  return input
}

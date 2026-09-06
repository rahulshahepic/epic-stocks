import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ImportExport from '../app/pages/ImportExport.tsx'

// The page has several file inputs (Excel import, Epic CSV, Epic PDF); this
// helper targets the Excel one these tests are about.
function getExcelUploadInput(): HTMLInputElement {
  const input = document.querySelector('input#import-file[type="file"]') as HTMLInputElement
  if (!input) throw new Error('No Excel import file input found')
  return input
}

beforeEach(() => {
  localStorage.setItem('auth_token', 'test-token')
  vi.restoreAllMocks()
})

function renderPage() {
  return render(<MemoryRouter><ImportExport /></MemoryRouter>)
}

describe('ImportExport', () => {
  it('renders all sections including template', () => {
    renderPage()
    expect(screen.getByText('Import / Export')).toBeInTheDocument()
    expect(screen.getByText('Enter it myself')).toBeInTheDocument()
    expect(screen.getByText('Download Blank Template')).toBeInTheDocument()
    expect(screen.getByText('Download Sample (fake data)')).toBeInTheDocument()
    expect(screen.getByText('Import from Excel')).toBeInTheDocument()
    expect(screen.getByText('Export to Excel')).toBeInTheDocument()
  })

  it('leads with the Shareworks import, ahead of typing it in', () => {
    renderPage()
    const headings = screen.getAllByText(
      /Import from Shareworks|Enter it myself|Import from Excel/)
    expect(headings.map(h => h.textContent)).toEqual(
      ['Import from Shareworks', 'Enter it myself', 'Import from Excel'])
  })

  it('shows confirmation dialog after file selection', async () => {
    renderPage()
    const input = getExcelUploadInput()
    const file = new File(['test'], 'Vesting.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await userEvent.upload(input, file)

    expect(screen.getByText(/Data for each imported sheet will be replaced/)).toBeInTheDocument()
    expect(screen.getByText('Import')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('cancel clears confirmation', async () => {
    renderPage()
    const input = getExcelUploadInput()
    const file = new File(['test'], 'Vesting.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await userEvent.upload(input, file)

    await userEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText(/Data for each imported sheet/)).not.toBeInTheDocument()
  })

  it('shows success message after import', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ grants: 12, loans: 21, prices: 8, sheets_imported: ['Schedule', 'Loans', 'Prices'] }), { status: 201 })
    )
    renderPage()
    const input = getExcelUploadInput()
    const file = new File(['test'], 'Vesting.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await userEvent.upload(input, file)
    await userEvent.click(screen.getByText('Import'))

    await waitFor(() => {
      expect(screen.getByText(/Imported Schedule, Loans, Prices: 12 grants, 21 loans, 8 prices/)).toBeInTheDocument()
    })
  })

  it('shows error message on import failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Bad file format' }), { status: 400 })
    )
    renderPage()
    const input = getExcelUploadInput()
    const file = new File(['test'], 'Vesting.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await userEvent.upload(input, file)
    await userEvent.click(screen.getByText('Import'))

    await waitFor(() => {
      expect(screen.getByText('Bad file format')).toBeInTheDocument()
    })
  })

  it('template download triggers fetch', async () => {
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
    await userEvent.click(screen.getByText('Download Blank Template'))

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled()
    })
  })

  it('sample download triggers fetch', async () => {
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
    await userEvent.click(screen.getByText('Download Sample (fake data)'))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/import/sample', expect.any(Object))
      expect(createObjectURL).toHaveBeenCalled()
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
    await userEvent.click(screen.getByText('Export to Excel'))

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled()
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test')
    })
  })

  it('shows error on export failure', async () => {
    const mockResponse = { ok: false, status: 500 } as unknown as Response
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    renderPage()
    await userEvent.click(screen.getByText('Export to Excel'))

    await waitFor(() => {
      expect(screen.getByText('Export failed (500)')).toBeInTheDocument()
    })
  })
})


import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import StockFiles from '../app/components/StockFiles.tsx'
import { stockFiles } from '../app/stockFiles.ts'

describe('stock file selection', () => {
  const csv = new File(['fictional'], 'stock.CSV')
  const pdf = new File(['%PDF-fictional'], 'loans.pdf')
  it('accepts both orders and either single file', () => {
    expect(stockFiles([pdf, csv])).toEqual({ workbook: csv, statement: pdf })
    expect(stockFiles([csv, pdf])).toEqual({ workbook: csv, statement: pdf })
    expect(stockFiles([pdf])).toEqual({ statement: pdf })
    expect(stockFiles([csv])).toEqual({ workbook: csv })
  })
  it('rejects wrong and duplicate types without changing a valid selection', () => {
    const onFiles = vi.fn()
    render(<StockFiles csv={csv} pdf={null} onFiles={onFiles} />)
    fireEvent.change(screen.getByLabelText('Stock files (.csv, .xlsx, .pdf)'), { target: { files: [pdf, new File(['x'], 'image.png')] } })
    expect(onFiles).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a CSV')
    expect(stockFiles.bind(null, [csv, csv])).toThrow('one stock workbook')
    expect(screen.getByRole('status')).toHaveTextContent('stock.CSV')
  })
  it('classifies a drop and ignores drops while busy', () => {
    const onFiles = vi.fn()
    const { rerender } = render(<StockFiles csv={null} pdf={null} onFiles={onFiles} />)
    const zone = screen.getByText('Add your stock files').parentElement!
    fireEvent.drop(zone, { dataTransfer: { files: [pdf, csv] } })
    expect(onFiles).toHaveBeenCalledWith({ workbook: csv, statement: pdf })
    rerender(<StockFiles csv={null} pdf={null} onFiles={onFiles} disabled />)
    fireEvent.drop(zone, { dataTransfer: { files: [csv] } })
    expect(onFiles).toHaveBeenCalledTimes(1)
  })
})

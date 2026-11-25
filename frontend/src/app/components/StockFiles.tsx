import { useId, useState } from 'react'
import { stockFiles } from '../stockFiles.ts'

export default function StockFiles({ csv, pdf, onFiles, disabled = false }: {
  csv: File | null; pdf: File | null
  onFiles: (files: { workbook?: File; statement?: File }) => void; disabled?: boolean
}) {
  const id = useId()
  const [error, setError] = useState('')
  function choose(files: File[]) {
    if (disabled) return
    try { const picked = stockFiles(files); onFiles(picked); setError('') }
    catch (e) { setError((e as Error).message) }
  }
  return <div className="space-y-2">
    <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); choose(Array.from(e.dataTransfer.files)) }}
      className="rounded-xl border-2 border-dashed border-cs-border-strong bg-cs-raised p-4">
      <label htmlFor={id} className="block text-sm font-semibold text-cs-text">Drop your stock files here, or choose files</label>
      <p className="mt-1 text-xs text-cs-text-2">Workbook and loan statement together, in either order.</p>
      <input id={id} aria-label="Stock files (.csv, .xlsx, .pdf)" type="file" multiple accept=".csv,.xlsx,.pdf" disabled={disabled}
        className="mt-3 block w-full min-w-0 text-xs text-cs-text" onChange={e => { choose(Array.from(e.target.files ?? [])); e.target.value = '' }} />
    </div>
    <p role="status" className="break-words text-xs text-cs-text-2">{csv ? `Got your stock workbook: ${csv.name}` : 'Stock workbook: not selected'} · {pdf ? `Got your loan statement: ${pdf.name}` : 'Loan statement: optional if you have no loans'}</p>
    {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
  </div>
}

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
      <p className="text-sm font-semibold text-cs-text">{csv || pdf ? 'Add or replace stock files' : 'Add your stock files'}</p>
      <p className="mt-1 text-xs text-cs-text-2">You can select both files together or drop them here.</p>
      <input id={id} aria-label="Stock files (.csv, .xlsx, .pdf)" type="file" multiple accept=".csv,.xlsx,.pdf" disabled={disabled}
        className="peer sr-only" onChange={e => { choose(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      <label htmlFor={id} className="mt-3 inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-cs-border-strong bg-cs-surface px-4 text-sm font-semibold text-cs-text peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-cs-brand peer-disabled:cursor-default peer-disabled:opacity-50">
        {csv || pdf ? 'Choose more files' : 'Choose files'}
      </label>
    </div>
    <p role="status" className="break-words text-xs text-cs-text-2">{csv ? `Got your stock workbook: ${csv.name}` : 'Stock workbook: not selected'} · {pdf ? `Got your loan statement: ${pdf.name}` : 'Loan statement: optional if you have no loans'}</p>
    {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
  </div>
}

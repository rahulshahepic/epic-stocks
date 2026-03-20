import { useState, useRef } from 'react'
import { getToken } from '../api.ts'

type Status = 'idle' | 'uploading' | 'success' | 'error' | 'confirm' | 'exporting'

interface ImportResult {
  grants: number
  prices: number
  loans: number
}

export default function ImportExport() {
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setStatus('confirm')
    setError('')
    setResult(null)
  }

  function cancelImport() {
    setSelectedFile(null)
    setStatus('idle')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function confirmImport() {
    if (!selectedFile) return
    setStatus('uploading')
    setError('')
    try {
      const form = new FormData()
      form.append('file', selectedFile)
      const resp = await fetch('/api/import/excel', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => null)
        throw new Error(body?.detail || `Import failed (${resp.status})`)
      }
      const data: ImportResult = await resp.json()
      setResult(data)
      setStatus('success')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed')
      setStatus('error')
    } finally {
      setSelectedFile(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleExport() {
    setStatus('exporting')
    setError('')
    try {
      const resp = await fetch('/api/export/excel', {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (!resp.ok) throw new Error(`Export failed (${resp.status})`)
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'Vesting.xlsx'
      a.click()
      URL.revokeObjectURL(url)
      setStatus('idle')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Export failed')
      setStatus('error')
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Import / Export</h2>

      {/* Import Section */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Import from Excel</h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Upload a Vesting.xlsx file to populate your grants, loans, and prices.
        </p>

        <div className="mt-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileSelect}
            className="block w-full text-xs text-gray-500 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 dark:text-gray-400 dark:file:bg-indigo-900/40 dark:file:text-indigo-300"
          />
        </div>

        {status === 'confirm' && selectedFile && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/30">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
              This will replace all your existing grants, loans, and prices with data from the uploaded file. This cannot be undone.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={confirmImport}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
              >
                Replace All Data
              </button>
              <button
                onClick={cancelImport}
                className="rounded-md bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {status === 'uploading' && (
          <p className="mt-3 text-xs text-gray-500">Uploading and processing...</p>
        )}

        {status === 'success' && result && (
          <div className="mt-3 rounded-md bg-green-50 p-3 dark:bg-green-900/30">
            <p className="text-xs font-medium text-green-800 dark:text-green-300">
              Import complete: {result.grants} grants, {result.loans} loans, {result.prices} prices
            </p>
          </div>
        )}

        {status === 'error' && error && (
          <p className="mt-3 text-xs text-red-500">{error}</p>
        )}
      </section>

      {/* Export Section */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Export to Excel</h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Download your data as a Vesting.xlsx file with Schedule, Loans, Prices, and Events sheets.
        </p>
        <button
          onClick={handleExport}
          disabled={status === 'exporting'}
          className="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {status === 'exporting' ? 'Exporting...' : 'Download Vesting.xlsx'}
        </button>
      </section>
    </div>
  )
}

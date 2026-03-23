import { useState, useRef } from 'react'
import { getToken } from '../api.ts'

const COLUMN_GUIDE = {
  Schedule: [
    { col: 'year', desc: 'Grant year (e.g. 2021). Matches the year on your Epic annual statement.' },
    { col: 'type', desc: '"RSU" for restricted stock units, "Option" for stock options.' },
    { col: 'shares', desc: 'Total shares granted that year.' },
    { col: 'price', desc: 'Grant price per share — $0 for RSUs, the option strike price for options.' },
    { col: 'vest_start', desc: 'Date vesting begins (YYYY-MM-DD). Typically March 1 of the grant year.' },
    { col: 'periods', desc: 'Number of vesting periods (usually 8 for a standard 4-year quarterly schedule).' },
    { col: 'exercise_date', desc: 'Date by which options must be exercised. Leave blank for RSUs.' },
    { col: 'dp_shares', desc: 'Down-payment shares used to purchase this grant. Find on your purchase confirmation; enter as a positive number.' },
  ],
  Loans: [
    { col: 'grant_year', desc: 'Year of the grant this loan is associated with.' },
    { col: 'grant_type', desc: '"RSU" or "Option" — must match the Schedule entry.' },
    { col: 'loan_type', desc: '"Purchase" for the original loan, "Interest" for accrued interest loans, "Tax" for tax-withholding loans.' },
    { col: 'loan_year', desc: 'Year this loan was issued.' },
    { col: 'amount', desc: 'Loan principal amount in dollars.' },
    { col: 'interest_rate', desc: 'Annual interest rate as a decimal (e.g. 0.05 for 5%).' },
    { col: 'due_date', desc: 'Loan due date (YYYY-MM-DD).' },
    { col: 'loan_number', desc: 'Loan number from your Epic statement. Used to match loans to payoff sales.' },
  ],
  Prices: [
    { col: 'effective_date', desc: 'Date the price takes effect (YYYY-MM-DD). Usually March 1 each year when Epic announces the share price.' },
    { col: 'price', desc: 'Share price in dollars.' },
  ],
}

type Status = 'idle' | 'uploading' | 'success' | 'error' | 'confirm' | 'exporting'

interface ImportResult {
  grants: number
  prices: number
  loans: number
  payoff_sales: number
  sheets_imported: string[]
}

export default function ImportExport() {
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [generatePayoffSales, setGeneratePayoffSales] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
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
      const resp = await fetch(`/api/import/excel?generate_payoff_sales=${generatePayoffSales}`, {
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

  async function handleTemplateDownload() {
    try {
      const resp = await fetch('/api/import/template', {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (!resp.ok) throw new Error(`Download failed (${resp.status})`)
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'Vesting_Template.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Template download failed')
      setStatus('error')
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Import / Export</h2>

      {/* Template Section */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Get Started</h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Download a template with the correct format. Fill in only the sheets you need — Schedule (grants), Loans, and/or Prices.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={handleTemplateDownload}
            className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Download Template
          </button>
          <button
            onClick={() => setShowGuide(v => !v)}
            className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {showGuide ? 'Hide column guide' : 'What do the columns mean?'}
          </button>
        </div>

        {showGuide && (
          <div className="mt-4 space-y-4">
            {(Object.entries(COLUMN_GUIDE) as [string, { col: string; desc: string }[]][]).map(([sheet, cols]) => (
              <div key={sheet}>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{sheet} sheet</p>
                <dl className="mt-1 divide-y divide-gray-100 dark:divide-gray-800">
                  {cols.map(({ col, desc }) => (
                    <div key={col} className="flex gap-2 py-1.5">
                      <dt className="w-32 shrink-0 font-mono text-xs text-indigo-600 dark:text-indigo-400">{col}</dt>
                      <dd className="text-xs text-gray-500 dark:text-gray-400">{desc}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Import Section */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Import from Excel</h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Upload a .xlsx file with Schedule, Loans, and/or Prices sheets. Only sheets present in your file will be processed — others are left unchanged.
        </p>

        <div className="mt-3 space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileSelect}
            className="block w-full text-xs text-gray-500 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 dark:text-gray-400 dark:file:bg-indigo-900/40 dark:file:text-indigo-300"
          />
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={generatePayoffSales}
              onChange={e => setGeneratePayoffSales(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            <span>
              Generate payoff sales for loans in this file (recommended)
              <span className="ml-1 text-gray-400" title="For each loan in the file, automatically creates a stock sale sized to cover the payoff after capital gains tax. Only applies if file contains a Loans sheet.">ⓘ</span>
            </span>
          </label>
        </div>

        {status === 'confirm' && selectedFile && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/30">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
              Data for each imported sheet will be replaced (including any existing payoff sales if Loans sheet is present). Sheets not in the file are left untouched.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={confirmImport}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
              >
                Import
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
              Imported {result.sheets_imported.join(', ')}: {result.grants} grants, {result.loans} loans, {result.prices} prices
              {result.payoff_sales > 0 && `, ${result.payoff_sales} payoff sales generated`}
            </p>
          </div>
        )}

        {status === 'error' && error && (
          <div className="mt-3 rounded-md bg-red-50 p-3 dark:bg-red-900/30">
            <p className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{error}</p>
          </div>
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

import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'


const COLUMN_GUIDE = {
  Schedule: [
    { col: 'year', desc: 'Grant year (e.g. 2021). Matches the year on your Epic annual statement.' },
    { col: 'type', desc: '"RSU" (shares you own once they vest) or "Option" (the right to buy shares at a set price). Your Epic paperwork will say which.' },
    { col: 'shares', desc: 'Total shares granted that year.' },
    { col: 'price', desc: 'What you pay per share. $0 for RSUs. For options, the price set in your contract.' },
    { col: 'vest_start', desc: 'Date vesting begins (YYYY-MM-DD). Typically March 1 of the grant year.' },
    { col: 'periods', desc: 'How many times the grant vests in pieces (usually 8 for a standard 4-year quarterly schedule).' },
    { col: 'exercise_date', desc: 'Deadline to buy the shares (options only). Leave blank for RSUs.' },
    { col: 'dp_shares', desc: 'If you handed in existing shares toward this purchase, enter the count (positive number). Find this on your purchase confirmation. Leave blank if you paid cash.' },
    { col: '83(b)', desc: 'TRUE if you filed an 83(b) election with the IRS within 30 days of this grant (ask your tax advisor if unsure). Otherwise FALSE or leave blank.' },
  ],
  Loans: [
    { col: 'grant_year', desc: 'Year of the grant this loan is associated with.' },
    { col: 'grant_type', desc: '"RSU" or "Option" — must match the Schedule entry.' },
    { col: 'loan_type', desc: '"Purchase" = the original loan you used to buy the shares. "Interest" = a loan covering interest charges. "Tax" = a loan covering withholding tax.' },
    { col: 'loan_year', desc: 'Year this loan was issued.' },
    { col: 'amount', desc: 'How much was borrowed, in dollars.' },
    { col: 'interest_rate', desc: 'Annual interest rate as a decimal (e.g. 0.05 for 5%).' },
    { col: 'due_date', desc: 'Loan due date (YYYY-MM-DD).' },
    { col: 'loan_number', desc: 'Loan number from your Epic statement. Used to link the loan to the sale that repays it.' },
    { col: 'refinances_loan_number', desc: 'If this loan replaced an older one, enter the older loan\'s number. Leave blank otherwise. The old loan will then be marked "Refinanced" with nothing left to pay.' },
  ],
  LoanPayments: [
    { col: 'loan_number', desc: 'Loan # this payment applies to (must match a Loan # in the Loans sheet).' },
    { col: 'date', desc: 'Date the payment was made (YYYY-MM-DD).' },
    { col: 'amount', desc: 'Cash amount paid. Reduces the remaining balance on the loan.' },
    { col: 'notes', desc: 'Optional notes (e.g. payment reference number).' },
  ],
  Prices: [
    { col: 'effective_date', desc: 'Date the price takes effect (YYYY-MM-DD). Usually March 1 each year when Epic announces the share price.' },
    { col: 'price', desc: 'Share price in dollars.' },
  ],
  Sales: [
    { col: 'date', desc: 'Date of the sale (YYYY-MM-DD).' },
    { col: 'shares', desc: 'Number of shares sold.' },
    { col: 'price', desc: 'Sale price per share in dollars.' },
    { col: 'notes', desc: 'Optional notes.' },
    { col: 'loan_number', desc: 'If this sale was used to repay a loan, enter the loan number. The loan will then show as paid off.' },
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
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [generatePayoffSales, setGeneratePayoffSales] = useState(true)
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
        credentials: 'include',
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
      const resp = await fetch('/api/export/excel', { credentials: 'include' })
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
      const resp = await fetch('/api/import/template', { credentials: 'include' })
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

  async function handleSampleDownload() {
    try {
      const resp = await fetch('/api/import/sample', { credentials: 'include' })
      if (!resp.ok) throw new Error(`Download failed (${resp.status})`)
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'Vesting_Sample.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Sample download failed')
      setStatus('error')
    }
  }

  const isImporting = status === 'uploading'

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Import / Export</h2>

      {/* Setup Wizard — primary recommended action */}
      <button
        type="button"
        onClick={() => navigate('/wizard?mode=schedule')}
        className="flex w-full flex-col rounded-lg border-2 border-rose-400 bg-white p-4 text-left hover:border-rose-600 hover:shadow-md dark:border-rose-500 dark:bg-slate-900"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-rose-700 dark:text-rose-300">Setup Wizard</span>
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
            Recommended
          </span>
        </div>
        <span className="mt-1 text-xs text-gray-500 dark:text-slate-400">
          Step-by-step guided setup — enter grants, loans, and prices one at a time. We know Epic's grant schedule so you just fill in your numbers.
        </span>
      </button>

      {/* Import from Excel */}
      <div className="flex flex-col rounded-lg border-2 border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">Import from Excel</span>
        <span className="mt-1 text-xs text-gray-500 dark:text-slate-400">
          Upload a .xlsx file with Schedule, Loans, Prices, and/or Sales sheets. Only sheets present in your file will be processed — others are left unchanged.
        </span>



        <div className="mt-3 space-y-3">
          <label htmlFor="import-file" className="sr-only">Upload Excel file (.xlsx)</label>
          <input
            id="import-file"
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileSelect}
            disabled={isImporting}
            className="block w-full text-xs text-gray-500 file:mr-3 file:rounded-md file:border-0 file:bg-rose-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-rose-700 hover:file:bg-rose-100 disabled:opacity-50 dark:text-slate-400 dark:file:bg-rose-900/40 dark:file:text-rose-300"
          />
          <label className="flex items-start gap-2 text-xs text-gray-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={generatePayoffSales}
              onChange={e => setGeneratePayoffSales(e.target.checked)}
              className="mt-0.5 rounded border-gray-300 dark:border-slate-600"
            />
            <span>
              <span className="font-medium">Plan share sales to repay each loan</span>
              <span className="ml-1 text-stone-500 dark:text-slate-500">(recommended)</span>
              <br />
              <span className="text-stone-500 dark:text-slate-500">For each loan, the app will plan a share sale big enough to cover the loan plus the tax on it.</span>
            </span>
          </label>
        </div>

        {status === 'confirm' && selectedFile && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/30">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
              Data for each imported sheet will be replaced. Sheets not in the file are left untouched.
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
                className="rounded-md bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {isImporting && (
          <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">Uploading and processing...</p>
        )}

        {status === 'success' && result && (
          <div className="mt-3 rounded-md bg-green-50 p-3 dark:bg-green-900/30">
            <p className="text-xs font-medium text-green-800 dark:text-green-300">
              Imported {result.sheets_imported.join(', ')}: {result.grants} grants, {result.loans} loans, {result.prices} prices
              {result.payoff_sales > 0 && `, ${result.payoff_sales} repayment sales planned`}
            </p>
          </div>
        )}

        {status === 'error' && error && (
          <div className="mt-3 rounded-md bg-red-50 p-3 dark:bg-red-900/30">
            <p className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}
      </div>

      {/* Export to Excel */}
      <button
        type="button"
        onClick={handleExport}
        disabled={status === 'exporting'}
        className="flex w-full flex-col rounded-lg border-2 border-stone-200 bg-white p-4 text-left hover:border-rose-400 hover:shadow-md disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
      >
        <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">
          {status === 'exporting' ? 'Exporting...' : 'Export to Excel'}
        </span>
        <span className="mt-1 text-xs text-gray-500 dark:text-slate-400">
          Download your data as Vesting.xlsx — Schedule, Loans, Prices, and Events sheets.
        </span>
      </button>

      {/* Templates & Reference */}
      <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">Templates &amp; Reference</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={handleSampleDownload}
            className="rounded-md bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 dark:bg-rose-900/40 dark:text-rose-300 dark:hover:bg-rose-900/50"
          >
            Download Sample (fake data)
          </button>
          <button
            onClick={handleTemplateDownload}
            className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Download Blank Template
          </button>
          <button
            onClick={() => setShowGuide(v => !v)}
            className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {showGuide ? 'Hide column guide' : 'Column guide'}
          </button>
        </div>

        {showGuide && (
          <div className="mt-4 space-y-4">
            {(Object.entries(COLUMN_GUIDE) as [string, { col: string; desc: string }[]][]).map(([sheet, cols]) => (
              <div key={sheet}>
                <p className="text-xs font-semibold text-gray-700 dark:text-slate-300">{sheet} sheet</p>
                <dl className="mt-1 divide-y divide-gray-100 dark:divide-gray-800">
                  {cols.map(({ col, desc }) => (
                    <div key={col} className="flex gap-2 py-1.5">
                      <dt className="w-32 shrink-0 font-mono text-xs text-rose-700 dark:text-rose-400">{col}</dt>
                      <dd className="text-xs text-gray-500 dark:text-slate-400">{desc}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

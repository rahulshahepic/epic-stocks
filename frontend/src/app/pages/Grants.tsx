import { useCallback, useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../hooks/useIsMobile.ts'
import { api, ConflictError } from '../../api.ts'
import type { GrantEntry, LoanEntry, PriceEntry, SaleEntry, TaxSettings, SaleEstimate } from '../../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { broadcastChange, useDataSync } from '../hooks/useDataSync.ts'
import { TaxRateFields, ratesFromDefaults, ratesFromSale, DEFAULT_RATES } from './Sales.tsx'
import type { TaxRates } from './Sales.tsx'
import { useConfig } from '../../scaffold/hooks/useConfig.ts'
import { useViewing } from '../../scaffold/contexts/ViewingContext.tsx'

type GrantForm = Omit<GrantEntry, 'id' | 'version'>
type Mode = 'list' | 'add' | 'edit'

const empty: GrantForm = {
  year: new Date().getFullYear(),
  type: 'Purchase',
  shares: 0,
  price: 0,
  vest_start: '',
  periods: 4,
  exercise_date: '',
  dp_shares: 0,
  election_83b: false,
}

function ConflictBanner({ onReload, onDiscard }: { onReload: () => void; onDiscard: () => void }) {
  return (
    <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 dark:border-yellow-700 dark:bg-yellow-900/20">
      <p className="text-xs font-medium text-yellow-800 dark:text-yellow-300">
        This record was changed on another device. Reload to see the latest version, or discard your changes.
      </p>
      <div className="mt-2 flex gap-2">
        <button onClick={onReload} className="rounded-md bg-yellow-600 px-2 py-1 text-xs font-medium text-white hover:bg-yellow-700">
          Reload latest
        </button>
        <button onClick={onDiscard} className="rounded-md bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-gray-600">
          Discard my changes
        </button>
      </div>
    </div>
  )
}

function fmtPrice(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtNum(n: number) {
  return n.toLocaleString('en-US')
}

function priceAt(date: string, prices: PriceEntry[] | null | undefined): number {
  if (!prices || prices.length === 0) return 0
  let last = 0
  for (const p of [...prices].sort((a, b) => a.effective_date.localeCompare(b.effective_date))) {
    if (p.effective_date <= date) last = p.price
    else break
  }
  return last
}

export default function Grants() {
  const { viewing } = useViewing()
  const vid = viewing?.invitationId
  const readOnly = !!viewing

  const fetchGrants = useCallback(() => vid ? api.getSharedGrants(vid) : api.getGrants(), [vid])
  const { data: grants, loading, reload } = useApiData<GrantEntry[]>(fetchGrants)
  const fetchPrices = useCallback(() => vid ? api.getSharedPrices(vid) : api.getPrices(), [vid])
  const { data: prices } = useApiData<PriceEntry[]>(fetchPrices)
  const fetchLoans = useCallback(() => vid ? api.getSharedLoans(vid) : api.getLoans(), [vid])
  const { data: loans, reload: reloadLoans } = useApiData<LoanEntry[]>(fetchLoans)
  const fetchSales = useCallback(() => vid ? api.getSharedSales(vid) : api.getSales(), [vid])
  const { data: sales, reload: reloadSales } = useApiData<SaleEntry[]>(fetchSales)
  const fetchTaxSettings = useCallback(() => vid ? api.getSharedTaxSettings(vid) : api.getTaxSettings(), [vid])
  const { data: taxSettings } = useApiData<TaxSettings>(fetchTaxSettings)

  const config = useConfig()
  const epicMode = (config?.epic_mode ?? false) || readOnly
  const isMobile = useIsMobile()

  // IDs of loans that have been superseded by a refinance — never show these as the active loan
  const refinancedLoanIds = new Set((loans ?? []).map(l => l.refinances_loan_id).filter((id): id is number => id !== null))

  const [mode, setMode] = useState<Mode>('list')
  const [expandedGrantId, setExpandedGrantId] = useState<number | null>(null)
  const [form, setForm] = useState<GrantForm>(empty)
  const [editId, setEditId] = useState<number | null>(null)
  const [editVersion, setEditVersion] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)

  // Sell modal state
  const [sellModal, setSellModal] = useState<{
    grantYear: number
    grantType: string
    loanId?: number
  } | null>(null)
  const [sellDate, setSellDate] = useState('')
  const [sellPrice, setSellPrice] = useState('')
  const [sellTargetCash, setSellTargetCash] = useState('')
  const [sellEstimate, setSellEstimate] = useState<SaleEstimate | null>(null)
  const [sellEstimateLoading, setSellEstimateLoading] = useState(false)
  const [sellSubmitting, setSellSubmitting] = useState(false)
  const [sellError, setSellError] = useState('')
  const estimateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useDataSync('grants', reload)
  useDataSync('sales', reloadSales)

  // Loan fields (Purchase grants only)
  const [loanAmount, setLoanAmount] = useState(0)
  const [loanRate, setLoanRate] = useState(0)
  const [loanDueDate, setLoanDueDate] = useState('')
  const [loanNumber, setLoanNumber] = useState('')
  const [editLoanId, setEditLoanId] = useState<number | null>(null)
  const [editLoanVersion, setEditLoanVersion] = useState(1)

  // Catch-up shares (add mode only)
  const [catchUpChecked, setCatchUpChecked] = useState(false)
  const [catchUpShares, setCatchUpShares] = useState(0)

  // Payoff sale
  const [payoffSaleChecked, setPayoffSaleChecked] = useState(true)
  const [saleRates, setSaleRates] = useState<TaxRates>(DEFAULT_RATES)

  function resetForm() {
    setForm(empty)
    setLoanAmount(0)
    setLoanRate(0)
    setLoanDueDate('')
    setLoanNumber('')
    setEditId(null)
    setEditVersion(1)
    setEditLoanId(null)
    setEditLoanVersion(1)
    setPayoffSaleChecked(true)
    setSaleRates(ratesFromDefaults(taxSettings))
    setCatchUpChecked(false)
    setCatchUpShares(0)
    setError('')
    setConflict(false)
  }

  function openPurchase() {
    resetForm()
    setForm({ ...empty, type: 'Purchase', price: priceAt(new Date().toISOString().split('T')[0], prices) })
    setMode('add')
  }

  function openBonus() {
    resetForm()
    setForm({ ...empty, type: 'Bonus', price: priceAt(new Date().toISOString().split('T')[0], prices), dp_shares: 0 })
    setMode('add')
  }

  function openEdit(g: GrantEntry) {
    const { id, version, ...rest } = g
    setForm(rest)
    setEditId(id)
    setEditVersion(version)
    setError('')
    setConflict(false)

    const existingLoan = loans?.find(
      l => l.grant_year === g.year && l.grant_type === g.type && l.loan_type === 'Purchase' && !refinancedLoanIds.has(l.id)
    ) ?? null

    if (existingLoan) {
      setLoanAmount(existingLoan.amount)
      setLoanRate(existingLoan.interest_rate)
      setLoanDueDate(existingLoan.due_date)
      setLoanNumber(existingLoan.loan_number ?? '')
      setEditLoanId(existingLoan.id)
      setEditLoanVersion(existingLoan.version)

      const linkedSale = sales?.find(s => s.loan_id === existingLoan.id) ?? null
      setPayoffSaleChecked(!!linkedSale)
      setSaleRates(linkedSale ? ratesFromSale(linkedSale, taxSettings) : ratesFromDefaults(taxSettings))
    } else {
      setLoanAmount(0)
      setLoanRate(0)
      setLoanDueDate('')
      setLoanNumber('')
      setEditLoanId(null)
      setEditLoanVersion(1)
      setPayoffSaleChecked(true)
      setSaleRates(ratesFromDefaults(taxSettings))
    }
    setMode('edit')
  }

  async function handleSave(addAnother: boolean) {
    setSaving(true)
    setError('')
    try {
      if (mode === 'add') {
        if (form.type === 'Purchase') {
          const result = await api.newPurchase({
            year: form.year,
            shares: form.shares,
            price: form.price,
            vest_start: form.vest_start,
            periods: form.periods,
            exercise_date: form.exercise_date,
            dp_shares: form.dp_shares || undefined,
            loan_amount: loanAmount || undefined,
            loan_rate: loanRate || undefined,
            loan_due_date: loanDueDate || undefined,
            loan_number: loanNumber || undefined,
            generate_payoff_sale: false,  // handle manually below
          })
          // Handle payoff sale for new purchase
          const newLoanId = result.loan?.id
          if (newLoanId && loanAmount > 0 && payoffSaleChecked) {
            const suggestion = await api.getLoanPayoffSuggestion(newLoanId)
            await api.createSale({
              date: suggestion.date,
              shares: suggestion.shares,
              price_per_share: suggestion.price_per_share,
              notes: suggestion.notes,
              loan_id: newLoanId,
              ...saleRates,
            })
            broadcastChange('sales')
          }
        } else {
          await api.addBonus({
            year: form.year,
            shares: form.shares,
            price: form.price || undefined,
            vest_start: form.vest_start,
            periods: form.periods,
            exercise_date: form.exercise_date,
            election_83b: form.election_83b || undefined,
          })
        }
        if (catchUpChecked && catchUpShares > 0) {
          await api.createGrant({
            year: form.year,
            type: 'Catch-Up',
            shares: catchUpShares,
            price: 0,
            vest_start: form.vest_start,
            periods: form.periods,
            exercise_date: form.exercise_date,
            dp_shares: 0,
            election_83b: false,
          })
        }
      } else if (mode === 'edit' && editId != null) {
        await api.updateGrant(editId, { ...form, version: editVersion })

        if (form.type === 'Purchase') {
          let loanId = editLoanId

          if (editLoanId != null) {
            await api.updateLoan(editLoanId, {
              amount: loanAmount,
              interest_rate: loanRate,
              due_date: loanDueDate,
              loan_number: loanNumber || null,
              version: editLoanVersion,
            })
            broadcastChange('loans')
            reloadLoans()
          } else if (loanAmount > 0) {
            const newLoan = await api.createLoan({
              grant_year: form.year,
              grant_type: 'Purchase',
              loan_type: 'Purchase',
              loan_year: form.year,
              amount: loanAmount,
              interest_rate: loanRate,
              due_date: loanDueDate,
              loan_number: loanNumber || null,
              refinances_loan_id: null,
            }, false)
            loanId = newLoan.id
            broadcastChange('loans')
            reloadLoans()
          }

          // Handle payoff sale
          if (loanId != null && loanAmount > 0) {
            const linkedSale = sales?.find(s => s.loan_id === loanId)
            if (payoffSaleChecked) {
              const suggestion = await api.getLoanPayoffSuggestion(loanId)
              const salePayload = {
                date: suggestion.date,
                shares: suggestion.shares,
                price_per_share: suggestion.price_per_share,
                notes: suggestion.notes,
                loan_id: loanId,
                ...saleRates,
              }
              if (linkedSale) {
                await api.updateSale(linkedSale.id, { ...salePayload, version: linkedSale.version })
              } else {
                await api.createSale(salePayload)
              }
              broadcastChange('sales')
              reloadSales()
            } else if (linkedSale) {
              await api.deleteSale(linkedSale.id)
              broadcastChange('sales')
              reloadSales()
            }
          }
        }
      }

      broadcastChange('grants')
      reload()
      if (addAnother) {
        const prevType = form.type
        resetForm()
        setForm(() => ({ ...empty, type: prevType, price: priceAt(new Date().toISOString().split('T')[0], prices) }))
      } else {
        setMode('list')
        resetForm()
      }
    } catch (e: unknown) {
      if (e instanceof ConflictError) {
        setConflict(true)
      } else {
        setError(e instanceof Error ? e.message : 'Save failed')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this grant?')) return
    await api.deleteGrant(id)
    broadcastChange('grants')
    reload()
  }

  function openSellModal(g: GrantEntry) {
    const loan = loans?.find(l => l.grant_year === g.year && l.grant_type === g.type && l.loan_type === 'Purchase' && !refinancedLoanIds.has(l.id))
    const today = new Date().toISOString().split('T')[0]
    setSellModal({ grantYear: g.year, grantType: g.type, loanId: loan?.id })
    setSellDate(today)
    setSellPrice(String(priceAt(today, prices) || ''))
    setSellTargetCash(loan ? String(loan.amount) : '')
    setSellEstimate(null)
    setSellError('')
  }

  function closeSellModal() {
    if (estimateTimerRef.current) clearTimeout(estimateTimerRef.current)
    setSellModal(null)
    setSellEstimate(null)
    setSellError('')
  }

  // When sale date changes, update price to the rate in effect on that date
  useEffect(() => {
    if (!sellModal || !sellDate) return
    setSellPrice(String(priceAt(sellDate, prices) || ''))
  }, [sellDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sellModal) return
    const price = parseFloat(sellPrice)
    const cash = parseFloat(sellTargetCash)
    if (!price || !cash) { setSellEstimate(null); return }
    if (estimateTimerRef.current) clearTimeout(estimateTimerRef.current)
    estimateTimerRef.current = setTimeout(async () => {
      setSellEstimateLoading(true)
      try {
        const est = await api.estimateSale({
          price_per_share: price,
          target_net_cash: cash,
          sale_date: sellDate || undefined,
          loan_id: sellModal.loanId,
          grant_year: sellModal.grantYear,
          grant_type: sellModal.grantType,
        })
        setSellEstimate(est)
      } catch {
        setSellEstimate(null)
      } finally {
        setSellEstimateLoading(false)
      }
    }, 300)
  }, [sellPrice, sellTargetCash, sellModal, sellDate])

  async function handleSell() {
    if (!sellModal || !sellEstimate) return
    setSellSubmitting(true)
    setSellError('')
    try {
      await api.createSale({
        date: sellDate || new Date().toISOString().split('T')[0],
        shares: sellEstimate.shares_needed,
        price_per_share: parseFloat(sellPrice),
        notes: `Sale — ${sellModal.grantType} ${sellModal.grantYear}`,
        loan_id: sellModal.loanId ?? null,
        ...ratesFromDefaults(taxSettings),
      })
      broadcastChange('sales')
      reload()
      reloadSales()
      closeSellModal()
    } catch (e: unknown) {
      setSellError(e instanceof Error ? e.message : 'Failed to create sale')
    } finally {
      setSellSubmitting(false)
    }
  }

  if (loading) return <p className="p-6 text-center text-sm text-stone-600">Loading...</p>
  if (!grants) return <p className="p-6 text-center text-sm text-red-500">Failed to load grants</p>

  const showLoanSection = form.type === 'Purchase'

  if (mode !== 'list') {
    const title = mode === 'add'
      ? (form.type === 'Purchase' ? 'New Purchase Grant' : 'New Bonus Grant')
      : 'Edit Grant'

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
          <button onClick={() => { setMode('list'); resetForm() }} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-slate-300">Cancel</button>
        </div>
        {conflict && (
          <ConflictBanner
            onReload={() => { reload(); setMode('list'); resetForm() }}
            onDiscard={() => { setMode('list'); resetForm() }}
          />
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}

        {/* Grant type selector — only for add mode */}
        {mode === 'add' && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, type: 'Purchase', dp_shares: f.dp_shares }))}
              className={`rounded-md px-3 py-1 text-xs font-medium ${form.type === 'Purchase' ? 'bg-rose-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'}`}
            >
              Purchase
            </button>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, type: 'Bonus', dp_shares: 0 }))}
              className={`rounded-md px-3 py-1 text-xs font-medium ${form.type === 'Bonus' ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'}`}
            >
              Bonus
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Year" type="number" value={form.year} onChange={v => setForm(f => ({ ...f, year: +v }))} />
          <Field label="Shares" type="number" value={form.shares} onChange={v => setForm(f => ({ ...f, shares: +v }))} />
          <Field
            label={form.type === 'Bonus' ? 'Cost Basis (optional)' : 'Cost Basis'}
            type="number" step="0.01"
            value={form.price}
            onChange={v => setForm(f => ({ ...f, price: +v }))}
          />
          <Field label="Vest Start" type="date" value={form.vest_start} onChange={v => setForm(f => ({ ...f, vest_start: v }))} />
          <Field label="Vest Periods" type="number" value={form.periods} onChange={v => setForm(f => ({ ...f, periods: +v }))} />
          <Field label="Exercise Date" type="date" value={form.exercise_date} onChange={v => setForm(f => ({ ...f, exercise_date: v }))} />
          {form.type === 'Purchase' && (
            <label className="block">
              <span className="text-xs text-gray-500 dark:text-slate-400">Down Payment Shares</span>
              <p className="text-[10px] text-stone-600 dark:text-slate-400">Bonus shares used first, then oldest (non-taxable exchange)</p>
              <input
                type="number"
                value={form.dp_shares}
                onChange={e => setForm(f => ({ ...f, dp_shares: +e.target.value }))}
                className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              />
            </label>
          )}
          {form.type !== 'Purchase' && (
            <label className="col-span-2 flex items-start gap-2 pt-1">
              <input
                type="checkbox"
                checked={!!form.election_83b}
                onChange={e => setForm(f => ({ ...f, election_83b: e.target.checked }))}
                className="mt-0.5 rounded border-gray-300 dark:border-slate-600"
              />
              <span className="text-xs text-gray-600 dark:text-slate-400">
                Filed 83(b) election — income recognized at grant time; vesting gains are unrealized cap gains
              </span>
            </label>
          )}
        </div>

        {mode === 'add' && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-400">
              <input
                type="checkbox"
                checked={catchUpChecked}
                onChange={e => setCatchUpChecked(e.target.checked)}
                className="rounded border-gray-300 dark:border-slate-600"
              />
              <span>Includes Catch-Up shares (zero-basis, vests as ordinary income)</span>
            </label>
            {catchUpChecked && (
              <div className="pl-5">
                <Field label="Catch-Up Shares" type="number" value={catchUpShares} onChange={v => setCatchUpShares(+v)} />
              </div>
            )}
          </div>
        )}

        {showLoanSection && (
          <>
            <h3 className="pt-1 text-sm font-medium text-gray-700 dark:text-slate-300">
              {mode === 'edit' && editLoanId != null ? 'Purchase Loan' : mode === 'edit' ? 'Add Loan' : 'Optional Loan'}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Loan Amount" type="number" step="0.01" value={loanAmount} onChange={v => {
                const total = (form.price || 0) * (form.shares || 0)
                const maxLoan = total > 0 ? Math.max(total * 0.90, total - 20000) : Infinity
                setLoanAmount(total > 0 ? Math.min(+v, maxLoan) : +v)
              }} />
              <Field label="Interest Rate (%)" type="number" step="0.01" value={+(loanRate * 100).toFixed(4)} onChange={v => setLoanRate(+v / 100)} />
              <Field label="Due Date" type="date" value={loanDueDate} onChange={v => setLoanDueDate(v)} />
              <Field label="Loan Number" type="text" value={loanNumber} onChange={v => setLoanNumber(v)} />
            </div>
            {loanAmount > 0 && (
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-400">
                  <input
                    type="checkbox"
                    checked={payoffSaleChecked}
                    onChange={e => setPayoffSaleChecked(e.target.checked)}
                    className="rounded border-gray-300 dark:border-slate-600"
                  />
                  <span>Payoff loan via sale</span>
                </label>
                {payoffSaleChecked && (
                  <TaxRateFields
                    rates={saleRates}
                    onChange={setSaleRates}
                    onReset={() => setSaleRates(ratesFromDefaults(taxSettings))}
                  />
                )}
              </div>
            )}
          </>
        )}

        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-2">
            <button
              onClick={() => handleSave(false)}
              disabled={saving}
              className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            {mode !== 'edit' && (
              <button
                onClick={() => handleSave(true)}
                disabled={saving}
                className="rounded-md bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-indigo-200 dark:bg-rose-900/40 dark:text-rose-300 dark:hover:bg-rose-900/50 disabled:opacity-50"
              >
                Save & Add Another
              </button>
            )}
          </div>
          {mode === 'edit' && editId != null && (
            <button
              onClick={() => handleDelete(editId)}
              className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              Delete grant
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Grants</h2>
        {!epicMode && (
          <div className="flex gap-2">
            <button onClick={openPurchase} className="rounded-md bg-rose-700 px-2 py-1 text-xs font-medium text-white hover:bg-rose-800">
              + Purchase
            </button>
            <button onClick={openBonus} className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800">
              + Bonus
            </button>
          </div>
        )}
      </div>
      {epicMode && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-indigo-900/20 dark:text-rose-300">
          {readOnly ? 'Viewing shared data — read only' : 'Data provided by Epic — view only'}
        </p>
      )}

      {/* Mobile card layout */}
      {isMobile ? <div className="space-y-2">
        {grants.map(g => {
          const loan = loans?.find(l => l.grant_year === g.year && l.grant_type === g.type && l.loan_type === 'Purchase' && !refinancedLoanIds.has(l.id))
          const linkedSale = loan ? sales?.find(s => s.loan_id === loan.id) : undefined
          const hasSale = !!linkedSale
          const isExpanded = expandedGrantId === g.id
          return (
            <div key={g.id} className="rounded-lg border border-stone-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
              {/* Line 1: Year + Type + Action */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-700 dark:text-slate-300">{g.year}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${g.type === 'Purchase' ? 'bg-rose-50 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'}`}>
                    {g.type}
                  </span>
                  {g.election_83b && (
                    <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">83(b)</span>
                  )}
                </div>
                {readOnly ? null : epicMode ? (
                  <button onClick={() => openSellModal(g)} className="text-emerald-700 hover:text-emerald-800 dark:text-emerald-300">Sell</button>
                ) : (
                  <button onClick={() => openEdit(g)} className="text-rose-700 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300">Edit</button>
                )}
              </div>
              {/* Line 2: Shares + Cost Basis */}
              <div className="mt-1 text-gray-700 dark:text-slate-300">
                <span className="tabular-nums">{fmtNum(g.shares)}</span> shares <span className="text-gray-400 dark:text-slate-500">&middot;</span> <span className="tabular-nums">{fmtPrice(g.price)}</span> basis
              </div>
              {/* Line 3: Vest details */}
              <div className="mt-1 text-gray-500 dark:text-slate-400">
                Vest: {g.vest_start} <span className="text-gray-400 dark:text-slate-500">&middot;</span> {g.periods} periods
                {g.exercise_date && <> <span className="text-gray-400 dark:text-slate-500">&middot;</span> Ex: {g.exercise_date}</>}
              </div>
              {/* Line 4: Loan status */}
              <div className="mt-1">
                {loan ? (
                  <button
                    onClick={() => setExpandedGrantId(isExpanded ? null : g.id)}
                    className={`text-[10px] underline decoration-dotted ${hasSale ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}
                  >
                    {hasSale ? '\u2713 loan+sale' : '\u2713 loan'} {isExpanded ? '\u25B2' : '\u25BC'}
                  </button>
                ) : (
                  <span className="text-[10px] text-stone-600">&mdash;</span>
                )}
              </div>
              {/* Expanded loan detail */}
              {isExpanded && loan && (
                <div className="mt-2 rounded-md bg-stone-50 p-3 dark:bg-slate-800">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <div><span className="text-stone-600 dark:text-slate-400">Amount</span> <span className="ml-1 font-medium text-gray-700 dark:text-slate-200">{fmtPrice(loan.amount)}</span></div>
                    <div><span className="text-stone-600 dark:text-slate-400">Rate</span> <span className="ml-1 font-medium text-gray-700 dark:text-slate-200">{(loan.interest_rate * 100).toFixed(2)}%</span></div>
                    <div><span className="text-stone-600 dark:text-slate-400">Due</span> <span className="ml-1 font-medium text-gray-700 dark:text-slate-200">{loan.due_date}</span></div>
                    <div><span className="text-stone-600 dark:text-slate-400">Loan #</span> <span className="ml-1 font-medium text-gray-700 dark:text-slate-200">{loan.loan_number ?? '\u2014'}</span></div>
                  </div>
                  {linkedSale ? (
                    <p className="mt-2 text-[10px] text-green-700 dark:text-green-300">
                      {'\u2713'} Payoff sale {linkedSale.date} &middot; {fmtNum(linkedSale.shares)} shares @ {fmtPrice(linkedSale.price_per_share)}
                    </p>
                  ) : (
                    <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">No payoff sale linked</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div> : /* Desktop table layout */
      <div tabIndex={0} className="overflow-x-auto rounded-lg border border-stone-200 dark:border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 dark:bg-slate-800">
            <tr className="text-gray-500 dark:text-slate-400">
              <th className="px-3 py-2">Year</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Shares</th>
              <th className="px-3 py-2 text-right">Cost Basis</th>
              <th className="px-3 py-2">Vest Start</th>
              <th className="px-3 py-2 text-right">Periods</th>
              <th className="px-3 py-2">Exercise</th>
              <th className="px-3 py-2">Loan</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {grants.map(g => {
              const loan = loans?.find(l => l.grant_year === g.year && l.grant_type === g.type && l.loan_type === 'Purchase' && !refinancedLoanIds.has(l.id))
              const linkedSale = loan ? sales?.find(s => s.loan_id === loan.id) : undefined
              const hasSale = !!linkedSale
              const isExpanded = expandedGrantId === g.id
              return (
                <>
                  <tr key={g.id} className="bg-white dark:bg-slate-900">
                    <td className="px-3 py-2 text-gray-700 dark:text-slate-300">{g.year}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${g.type === 'Purchase' ? 'bg-rose-50 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'}`}>
                        {g.type}
                      </span>
                      {g.election_83b && (
                        <span className="ml-1 inline-block rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">83(b)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-300">{fmtNum(g.shares)}</td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-300">{fmtPrice(g.price)}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{g.vest_start}</td>
                    <td className="px-3 py-2 text-right text-gray-500 dark:text-slate-400">{g.periods}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{g.exercise_date}</td>
                    <td className="px-3 py-2">
                      {loan ? (
                        <button
                          onClick={() => setExpandedGrantId(isExpanded ? null : g.id)}
                          className={`text-[10px] underline decoration-dotted ${hasSale ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}
                        >
                          {hasSale ? '\u2713 loan+sale' : '\u2713 loan'}
                        </button>
                      ) : (
                        <span className="text-[10px] text-stone-600">&mdash;</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {readOnly ? null : epicMode ? (
                        <button onClick={() => openSellModal(g)} className="text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-300">Sell</button>
                      ) : (
                        <button onClick={() => openEdit(g)} className="text-rose-700 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300">Edit</button>
                      )}
                    </td>
                  </tr>
                  {isExpanded && loan && (
                    <tr key={`${g.id}-loan`} className="bg-white dark:bg-slate-900">
                      <td colSpan={9} className="px-3 pb-3 pt-0">
                        <div className="rounded-md bg-stone-50 p-3 dark:bg-slate-800">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                            <div><span className="text-stone-600 dark:text-slate-400">Amount</span> <span className="ml-1 font-medium text-gray-700 dark:text-slate-200">{fmtPrice(loan.amount)}</span></div>
                            <div><span className="text-stone-600 dark:text-slate-400">Rate</span> <span className="ml-1 font-medium text-gray-700 dark:text-slate-200">{(loan.interest_rate * 100).toFixed(2)}%</span></div>
                            <div><span className="text-stone-600 dark:text-slate-400">Due</span> <span className="ml-1 font-medium text-gray-700 dark:text-slate-200">{loan.due_date}</span></div>
                            <div><span className="text-stone-600 dark:text-slate-400">Loan #</span> <span className="ml-1 font-medium text-gray-700 dark:text-slate-200">{loan.loan_number ?? '\u2014'}</span></div>
                          </div>
                          {linkedSale ? (
                            <p className="mt-2 text-[10px] text-green-700 dark:text-green-300">
                              {'\u2713'} Payoff sale {linkedSale.date} &middot; {fmtNum(linkedSale.shares)} shares @ {fmtPrice(linkedSale.price_per_share)}
                            </p>
                          ) : (
                            <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">No payoff sale linked</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>}
      {grants.length === 0 && (
        <p className="px-3 py-6 text-center text-xs text-stone-600">No grants yet</p>
      )}
      <p className="text-xs text-stone-600">{grants.length} grants</p>

      {/* Sell Shares Modal */}
      {sellModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                Sell Shares — {sellModal.grantType} {sellModal.grantYear}
              </h3>
              <button onClick={closeSellModal} aria-label="Close dialog" className="text-stone-600 hover:text-gray-600 dark:hover:text-slate-300">✕</button>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-gray-500 dark:text-slate-400">Sale Date</span>
                <input
                  type="date"
                  value={sellDate}
                  onChange={e => setSellDate(e.target.value)}
                  className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500 dark:text-slate-400">Target Net Cash ($)</span>
                <input
                  type="number"
                  step="0.01"
                  value={sellTargetCash}
                  onChange={e => setSellTargetCash(e.target.value)}
                  className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                  placeholder="e.g. 50000"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500 dark:text-slate-400">Price per Share ($)</span>
                <input
                  type="number"
                  step="0.01"
                  value={sellPrice}
                  onChange={e => setSellPrice(e.target.value)}
                  className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                  placeholder="e.g. 125.00"
                />
              </label>

              {sellEstimateLoading && (
                <p className="text-center text-xs text-stone-600">Estimating...</p>
              )}

              {sellEstimate && !sellEstimateLoading && (
                <div className="rounded-md bg-stone-50 p-3 text-xs dark:bg-slate-800">
                  <div className="grid grid-cols-2 gap-y-1.5">
                    <span className="text-gray-500 dark:text-slate-400">Shares needed</span>
                    <span className="text-right font-medium text-gray-800 dark:text-slate-200">{fmtNum(sellEstimate.shares_needed)}</span>
                    <span className="text-gray-500 dark:text-slate-400">Gross proceeds</span>
                    <span className="text-right font-medium text-gray-800 dark:text-slate-200">{fmtPrice(sellEstimate.gross_proceeds)}</span>
                    <span className="text-gray-500 dark:text-slate-400">Est. tax</span>
                    <span className="text-right font-medium text-red-600 dark:text-red-400">{fmtPrice(sellEstimate.estimated_tax)}</span>
                    <span className="text-gray-500 dark:text-slate-400">Net proceeds</span>
                    <span className="text-right font-medium text-emerald-700 dark:text-emerald-300">{fmtPrice(sellEstimate.net_proceeds)}</span>
                    {sellEstimate.loan_balance != null && (
                      <>
                        <span className="text-gray-500 dark:text-slate-400">Loan balance</span>
                        <span className="text-right font-medium text-gray-800 dark:text-slate-200">{fmtPrice(sellEstimate.loan_balance)}</span>
                        <span className="text-gray-500 dark:text-slate-400">Covers loan</span>
                        <span className={`text-right font-medium ${sellEstimate.covers_loan ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>
                          {sellEstimate.covers_loan ? 'Yes' : 'No'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {sellError && <p className="text-xs text-red-500">{sellError}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={closeSellModal} className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-gray-600">
                  Cancel
                </button>
                <button
                  onClick={handleSell}
                  disabled={!sellEstimate || sellSubmitting}
                  className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {sellSubmitting ? 'Creating sale...' : 'Confirm Sale'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, type, value, onChange, step }: {
  label: string; type: string; value: string | number; onChange: (v: string) => void; step?: string
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 dark:text-slate-400">{label}</span>
      <input
        type={type}
        step={step}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-0.5 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
      />
    </label>
  )
}

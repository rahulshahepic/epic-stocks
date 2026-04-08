import { useCallback, useState } from 'react'
import { api } from '../../api.ts'
import type { SmartTip, HorizonSettings, TaxSettings } from '../../api.ts'
import { useApiData } from '../hooks/useApiData.ts'

function fmt$(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

const TIP_ICONS: Record<SmartTip['type'], string> = {
  exit_date: '📅',
  deduction: '💸',
  method: '⚙️',
}

interface Props {
  onApply: () => void
}

export default function TipCarousel({ onApply }: Props) {
  const fetcher = useCallback(() => api.getTips(), [])
  const { data: allTips, loading } = useApiData(fetcher)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [index, setIndex] = useState(0)
  const [applying, setApplying] = useState(false)

  if (loading || !allTips) return null

  const tips = allTips.filter(t => !dismissed.has(t.type))
  if (tips.length === 0) return null

  const tip = tips[Math.min(index, tips.length - 1)]

  async function handleApply() {
    if (applying) return
    setApplying(true)
    try {
      // Record acceptance (fire-and-forget — don't block on failure)
      api.recordTipAcceptance(tip.type, tip.savings).catch(() => {})

      // Apply the setting change
      if (tip.type === 'exit_date') {
        await api.updateHorizonSettings(tip.apply as Partial<HorizonSettings>)
      } else {
        await api.updateTaxSettings(tip.apply as Partial<TaxSettings>)
      }

      // Remove this tip from local state
      const next = new Set(dismissed)
      next.add(tip.type)
      setDismissed(next)
      setIndex(i => Math.max(0, Math.min(i, tips.length - 2)))

      onApply()
    } catch {
      // leave tip visible; user can retry
    } finally {
      setApplying(false)
    }
  }

  function handleDismiss() {
    const next = new Set(dismissed)
    next.add(tip.type)
    setDismissed(next)
    setIndex(i => Math.max(0, Math.min(i, tips.length - 2)))
  }

  const canPrev = index > 0
  const canNext = index < tips.length - 1

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/60 dark:bg-amber-950/30">
      <div className="flex items-start gap-3">
        <span className="shrink-0 text-xl leading-none mt-0.5" aria-hidden="true">
          {TIP_ICONS[tip.type]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{tip.title}</p>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/50 dark:text-green-300">
              Save {fmt$(tip.savings)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">{tip.description}</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={handleApply}
              disabled={applying}
              className="rounded bg-amber-700 px-3 py-1 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-60 dark:bg-amber-600 dark:hover:bg-amber-700"
            >
              {applying ? 'Applying…' : 'Apply'}
            </button>
            <button
              onClick={handleDismiss}
              className="text-xs text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
            >
              Dismiss
            </button>
          </div>
        </div>
        {tips.length > 1 && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => setIndex(i => Math.max(0, i - 1))}
              disabled={!canPrev}
              aria-label="Previous tip"
              className="rounded p-0.5 text-amber-700 hover:text-amber-900 disabled:opacity-30 dark:text-amber-400"
            >
              ‹
            </button>
            <button
              onClick={() => setIndex(i => Math.min(tips.length - 1, i + 1))}
              disabled={!canNext}
              aria-label="Next tip"
              className="rounded p-0.5 text-amber-700 hover:text-amber-900 disabled:opacity-30 dark:text-amber-400"
            >
              ›
            </button>
          </div>
        )}
      </div>
      {tips.length > 1 && (
        <div className="mt-2 flex justify-center gap-1">
          {tips.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Tip ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                i === index
                  ? 'w-4 bg-amber-700 dark:bg-amber-500'
                  : 'w-1.5 bg-amber-300 dark:bg-amber-700'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

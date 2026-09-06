import { useCallback, useState } from 'react'
import { api } from '../../api.ts'
import type { SmartTip, TaxSettings } from '../../api.ts'
import { useApiData } from '../hooks/useApiData.ts'
import { IconTile } from '../../scaffold/components/ui/Card.tsx'
import { fmt$ } from '../format.ts'

const TIP_ICONS: Record<SmartTip['type'], string> = {
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
      await api.updateTaxSettings(tip.apply as Partial<TaxSettings>)

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
    <div className="rounded-2xl border border-cs-border bg-cs-surface p-4 shadow-card">
      <div className="flex items-start gap-3">
        <IconTile tone="amber" className="h-10 w-10 shrink-0 rounded-xl text-lg leading-none">
          <span aria-hidden="true">{TIP_ICONS[tip.type]}</span>
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-cs-text">{tip.title}</p>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
              Save {fmt$(tip.savings)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-cs-text-2">{tip.description}</p>
          <div className="mt-2.5 flex items-center gap-3">
            <button
              onClick={handleApply}
              disabled={applying}
              className="rounded-full bg-cs-brand px-3 py-1 text-xs font-semibold text-white hover:bg-cs-brand-hover disabled:opacity-60"
            >
              {applying ? 'Applying…' : 'Apply'}
            </button>
            <button
              onClick={handleDismiss}
              className="text-xs font-medium text-cs-text-2 hover:text-cs-text"
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
              className="rounded p-0.5 text-cs-text-2 hover:text-cs-text disabled:opacity-30"
            >
              ‹
            </button>
            <button
              onClick={() => setIndex(i => Math.min(tips.length - 1, i + 1))}
              disabled={!canNext}
              aria-label="Next tip"
              className="rounded p-0.5 text-cs-text-2 hover:text-cs-text disabled:opacity-30"
            >
              ›
            </button>
          </div>
        )}
      </div>
      {tips.length > 1 && (
        <div className="mt-2.5 flex justify-center gap-1">
          {tips.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Tip ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                i === index
                  ? 'w-4 bg-cs-brand'
                  : 'w-1.5 bg-cs-border-strong'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

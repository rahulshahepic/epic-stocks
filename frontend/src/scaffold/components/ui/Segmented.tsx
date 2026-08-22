/** Pill-shaped segmented control — used for chart range toggles and scenario pickers. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  ariaLabel?: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex flex-wrap gap-1 rounded-full bg-cs-raised p-1">
      {options.map(opt => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              active
                ? 'bg-cs-brand text-white shadow-sm'
                : 'text-cs-text-2 hover:bg-cs-border/60 hover:text-cs-text'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

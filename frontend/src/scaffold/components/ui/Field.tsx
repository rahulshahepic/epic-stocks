import { useState } from 'react'

/** The one input style. Bare inputs that can't use <Field> should wear this. */
export const FIELD_INPUT_CLASS =
  'mt-0.5 block w-full rounded-md border border-cs-border-strong bg-cs-surface px-2 py-1.5 text-xs text-cs-text'

function Label({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      {/* Rendered even when empty: it holds the row's baseline in a grid of fields. */}
      <span className="text-xs text-cs-muted">{label}</span>
      {hint && <span className="ml-1.5 text-[10px] text-cs-muted">{hint}</span>}
      {children}
    </label>
  )
}

export function Field({
  label, type = 'text', value, onChange, step, min, max, placeholder, hint, disabled, inputMode,
}: {
  label: string
  type?: string
  value: string | number
  onChange: (v: string) => void
  step?: string
  min?: string
  max?: string
  placeholder?: string
  hint?: string
  disabled?: boolean
  inputMode?: 'decimal' | 'numeric' | 'text'
}) {
  return (
    <Label label={label} hint={hint}>
      <input
        type={type} step={step} min={min} max={max} placeholder={placeholder}
        disabled={disabled} inputMode={inputMode}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`${FIELD_INPUT_CLASS}${disabled ? ' opacity-50 cursor-not-allowed' : ''}`}
      />
    </Label>
  )
}

export function SelectField({ label, value, onChange, hint, disabled, children }: {
  label: string
  value: string | number
  onChange: (v: string) => void
  hint?: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <Label label={label} hint={hint}>
      <select
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className={`${FIELD_INPUT_CLASS}${disabled ? ' opacity-50 cursor-not-allowed' : ''}`}
      >
        {children}
      </select>
    </Label>
  )
}

/**
 * A rate held as a decimal (0.0307) but typed as a percentage (3.07).
 *
 * Editing goes through local state so a half-typed "3." or "3.0" survives the
 * round trip — parsing on every keystroke would rewrite them to "3".
 * Omit the label to get just the input, for use inside a grid of your own.
 */
export function PercentField({ label, value, onChange, hint, placeholder, className }: {
  label?: string
  value: string
  onChange: (decimalStr: string) => void
  hint?: string
  placeholder?: string
  className?: string
}) {
  const [local, setLocal] = useState('')
  const [focused, setFocused] = useState(false)

  const toDisplay = (v: string) => v ? String(Math.round(parseFloat(v) * 1e6) / 1e4) : ''

  const input = (
    <input
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      value={focused ? local : toDisplay(value)}
      onFocus={() => { setLocal(toDisplay(value)); setFocused(true) }}
      onChange={e => {
        const v = e.target.value
        if (v === '' || /^-?\d*\.?\d*$/.test(v)) {
          setLocal(v)
          const num = parseFloat(v)
          if (!isNaN(num)) onChange(String(num / 100))
          else if (v === '') onChange('')
        }
      }}
      onBlur={() => {
        setFocused(false)
        if (local) {
          const num = parseFloat(local)
          if (!isNaN(num)) onChange(String(num / 100))
        } else onChange('')
      }}
      className={className ?? FIELD_INPUT_CLASS}
    />
  )

  if (!label) return input
  return <Label label={label} hint={hint}>{input}</Label>
}

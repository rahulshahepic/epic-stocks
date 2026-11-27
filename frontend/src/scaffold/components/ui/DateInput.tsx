import { useId, useState, type ComponentPropsWithRef } from 'react'

type DateInputProps = Omit<ComponentPropsWithRef<'input'>, 'type' | 'value'> & { value: string | number }

function supportsNativeDate() {
  if (typeof document === 'undefined') return true
  const input = document.createElement('input')
  input.type = 'date'
  return input.type === 'date'
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function DateInput({ value, onChange, onBlur, onInvalid, min, max, className, ...props }: DateInputProps) {
  const [native] = useState(supportsNativeDate)
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState('')
  const errorId = useId()

  function validate(text: string) {
    if (text && !isCalendarDate(text)) return 'Enter a valid date in YYYY-MM-DD format.'
    if (text && min && text < String(min)) return `Choose a date on or after ${min}.`
    if (text && max && text > String(max)) return `Choose a date on or before ${max}.`
    return ''
  }

  return (
    <>
      <input
        {...props}
        type={native ? 'date' : 'text'}
        placeholder={native ? props.placeholder : 'YYYY-MM-DD'}
        min={min}
        max={max}
        value={draft ?? value}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={[props['aria-describedby'], error && errorId].filter(Boolean).join(' ') || undefined}
        className={`cs-date-input ${className ?? 'w-full'}`}
        onChange={event => {
          const text = event.currentTarget.value
          const problem = validate(text)
          setError(problem)
          if (!native) event.currentTarget.setCustomValidity(problem)
          if (!native && problem) {
            setDraft(text)
          } else if (!event.currentTarget.validity.badInput) {
            setDraft(null)
            onChange?.(event)
          }
        }}
        onInvalid={event => {
          setError(event.currentTarget.validationMessage)
          onInvalid?.(event)
        }}
        onBlur={event => {
          const { badInput, valueMissing } = event.currentTarget.validity
          const problem = badInput ? 'Enter a valid date.' : valueMissing ? 'Enter a date.' : validate(event.currentTarget.value)
          setError(problem)
          if (!problem) {
            setDraft(null)
            onBlur?.(event)
          }
        }}
      />
      {error && <span id={errorId} role="alert" className="block text-xs text-red-700 dark:text-red-300">{error}</span>}
    </>
  )
}

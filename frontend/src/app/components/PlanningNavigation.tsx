import { useLayoutEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

const tabs = [
  { view: 'expenses', label: 'Planned Expenses', shortLabel: 'Expenses', to: '/planning?view=expenses' },
  { view: 'retirement', label: 'Retirement', shortLabel: 'Retirement', to: '/planning' },
  { view: 'compensation', label: 'Compensation Calculator', shortLabel: 'Comp Calc', to: '/comp-calculator' },
] as const

type PlanningView = typeof tabs[number]['view']

export default function PlanningNavigation({ view, onViewChange, beforeNavigate }: {
  view: PlanningView
  onViewChange?: (expenses: boolean) => void
  beforeNavigate?: () => Promise<boolean>
}) {
  const navigate = useNavigate()
  const { key } = useLocation()
  const navigating = useRef<symbol | null>(null)
  useLayoutEffect(() => () => { navigating.current = null }, [key])
  return (
    <div role="group" aria-label="Planning" className="grid grid-cols-3 gap-1 rounded-xl border border-cs-border bg-cs-raised p-1">
      {tabs.map(tab => {
        const selected = tab.view === view
        const className = `flex min-h-11 items-center justify-center rounded-lg border px-1 py-2 text-center text-xs font-semibold sm:text-sm ${selected
          ? 'border-cs-brand bg-cs-brand-subtle text-cs-brand dark:text-rose-300'
          : 'border-transparent text-cs-text hover:bg-cs-surface'}`
        const label = <><span className="sm:hidden">{tab.shortLabel}</span><span className="hidden sm:inline">{tab.label}</span></>
        return tab.view !== 'compensation' && onViewChange
          ? <button key={tab.view} type="button" aria-label={tab.label} aria-pressed={selected} className={className} onClick={() => onViewChange(tab.view === 'expenses')}>{label}</button>
          : <Link key={tab.view} to={tab.to} aria-label={tab.label} aria-current={selected ? 'page' : undefined} className={className} onClick={async event => {
            if (!beforeNavigate || selected || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
            event.preventDefault()
            if (navigating.current) return
            const attempt = Symbol()
            navigating.current = attempt
            try {
              if (await beforeNavigate() && navigating.current === attempt) navigate(tab.to)
            } finally {
              if (navigating.current === attempt) navigating.current = null
            }
          }}>{label}</Link>
      })}
    </div>
  )
}

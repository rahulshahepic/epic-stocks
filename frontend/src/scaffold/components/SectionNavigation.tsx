import { useId, useLayoutEffect, useRef } from 'react'
import { Link, useLocation, useNavigationType } from 'react-router-dom'
import { Card } from './ui/Card.tsx'

type SectionCategory = { hash: string; label: string; description: string }

export function SectionNavigation({
  title, categories, active, panelLabel, headerContent, indexContent, showBuildVersion, compact = false, children,
}: {
  title: string
  categories: readonly SectionCategory[]
  active?: SectionCategory
  panelLabel?: string
  headerContent?: React.ReactNode
  indexContent?: React.ReactNode
  showBuildVersion?: boolean
  compact?: boolean
  children: React.ReactNode
}) {
  const { pathname, search, hash } = useLocation()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const navigationType = useNavigationType()
  const previousActive = useRef<string | undefined>(undefined)
  const indexReturn = useRef<{ hash: string; scrollY: number } | null>(null)
  const categoryLinks = useRef(new Map<string, HTMLAnchorElement>())
  const activeHash = active?.hash
  const id = useId()
  const tabId = (section: string) => `${id}-tab-${section.slice(1)}`
  const panelId = (section: string) => `${id}-panel-${section.slice(1)}`

  useLayoutEffect(() => {
    if (compact) {
      if (previousActive.current === undefined && hash && activeHash) panelRef.current?.focus({ preventScroll: true })
      previousActive.current = activeHash
      return
    }
    const changed = activeHash !== previousActive.current
    if (activeHash && changed) {
      panelRef.current?.focus({ preventScroll: true })
      if (navigationType !== 'POP' && window.scrollY > 0) window.scrollTo(0, 0)
    } else if (!activeHash && changed) {
      const saved = indexReturn.current
      const target = saved ? categoryLinks.current.get(saved.hash) : undefined
      const focusTarget = target ?? headingRef.current
      focusTarget?.focus({ preventScroll: true })
      if (navigationType !== 'POP' && (saved?.scrollY ?? 0) !== window.scrollY) {
        window.scrollTo(0, saved?.scrollY ?? 0)
      }
    }
    previousActive.current = activeHash
  }, [activeHash, compact, hash, navigationType])

  return (
    <div className="space-y-4">
      {compact
        ? <h2 className="sr-only">{title}</h2>
        : <h1 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-cs-text outline-none!">{title}</h1>}
      {headerContent}
      {!active && indexContent}
      <div className={active ? 'md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:items-start md:gap-5' : 'max-w-xl'}>
        <nav aria-label={`${title} categories`} className={compact ? 'mb-3 md:sticky md:top-[calc(var(--app-chrome-height,6rem)+4.5rem)] md:mb-0' : active ? 'hidden md:sticky md:top-[calc(var(--app-chrome-height,6rem)+1rem)] md:block' : ''}>
          <Card pad="none" className="overflow-hidden">
            <div role={compact ? 'tablist' : undefined} aria-label={compact ? title : undefined} className={compact
              ? 'grid auto-rows-fr grid-cols-2 gap-1 p-1 md:grid-cols-1 md:auto-rows-auto'
              : 'divide-y divide-cs-border'}>
              {categories.map((category, index) => (
                <Link
                  key={category.hash}
                  to={{ pathname, search, hash: category.hash }}
                  ref={element => {
                    if (element) categoryLinks.current.set(category.hash, element)
                    else categoryLinks.current.delete(category.hash)
                  }}
                  onClick={event => {
                    if (!active && event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                      indexReturn.current = { hash: category.hash, scrollY: window.scrollY }
                    }
                  }}
                  id={compact ? tabId(category.hash) : undefined}
                  role={compact ? 'tab' : undefined}
                  tabIndex={compact ? (activeHash === category.hash ? 0 : -1) : undefined}
                  aria-controls={compact ? panelId(category.hash) : undefined}
                  aria-selected={compact ? activeHash === category.hash : undefined}
                  aria-current={!compact && activeHash === category.hash ? 'location' : undefined}
                  onKeyDown={event => {
                    if (!compact || event.altKey || event.ctrlKey || event.metaKey) return
                    if (event.key === ' ') {
                      event.preventDefault()
                      event.currentTarget.click()
                      return
                    }
                    const columns = window.matchMedia('(min-width: 768px)').matches ? 1 : 2
                    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }
                    if (!(event.key in offsets) && event.key !== 'Home' && event.key !== 'End') return
                    event.preventDefault()
                    const target = event.key === 'Home' ? 0 : event.key === 'End' ? categories.length - 1 : (index + offsets[event.key] + categories.length) % categories.length
                    categoryLinks.current.get(categories[target].hash)?.focus()
                  }}
                  className={`flex min-h-14 items-center justify-between gap-3 px-4 py-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cs-brand ${compact ? 'rounded-lg border' : ''} ${activeHash === category.hash ? `bg-cs-brand-subtle ${compact ? 'border-cs-brand' : ''}` : 'border-transparent hover:bg-cs-raised'}`}
                >
                  <span>
                    <span className="block text-sm font-semibold text-cs-text">{category.label}</span>
                    <span className={compact ? 'mt-0.5 hidden text-xs text-cs-text-2 md:block' : 'mt-0.5 block text-xs text-cs-text-2'}>{category.description}</span>
                  </span>
                  {!compact && <span aria-hidden="true" className="text-cs-muted">›</span>}
                </Link>
              ))}
            </div>
          </Card>
        </nav>

        <div hidden={!active} className="min-w-0 space-y-2">
          {!compact && <Link to={{ pathname, search }} className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-cs-brand dark:text-rose-300 md:hidden">
            <span aria-hidden="true">‹</span> Back to {title}
          </Link>}
          {compact && categories.filter(category => category.hash !== activeHash).map(category => (
            <div key={category.hash} id={panelId(category.hash)} role="tabpanel" aria-labelledby={tabId(category.hash)} hidden />
          ))}
          <div ref={panelRef} tabIndex={compact ? 0 : -1} role={compact ? 'tabpanel' : 'region'}
            id={compact && activeHash ? panelId(activeHash) : undefined}
            aria-labelledby={compact && activeHash && !panelLabel ? tabId(activeHash) : undefined}
            aria-label={compact && !panelLabel ? undefined : panelLabel ?? active?.label}
            className={`min-w-0 space-y-4 ${compact ? 'rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cs-brand' : 'outline-none!'}`}>
            {children}
          </div>
        </div>
      </div>
      {showBuildVersion && import.meta.env.VITE_COMMIT_SHA && import.meta.env.VITE_COMMIT_SHA !== 'dev' && (
        <p className="text-center text-xs text-cs-text-2">
          {import.meta.env.VITE_COMMIT_SHA.slice(0, 7)}
        </p>
      )}
    </div>
  )
}

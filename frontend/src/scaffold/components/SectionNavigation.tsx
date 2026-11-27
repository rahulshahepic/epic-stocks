import { useLayoutEffect, useRef } from 'react'
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

  useLayoutEffect(() => {
    const changed = activeHash !== previousActive.current
    if (activeHash && (compact || changed)) {
      panelRef.current?.focus({ preventScroll: true })
      if (!compact && changed && navigationType !== 'POP' && window.scrollY > 0) window.scrollTo(0, 0)
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
          <Card pad="none" className={compact
            ? 'grid grid-cols-2 overflow-hidden divide-cs-border md:block md:divide-y'
            : 'divide-y divide-cs-border overflow-hidden'}>
            {categories.map(category => (
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
                aria-current={active?.hash === category.hash ? 'location' : undefined}
                className={`flex min-h-14 items-center justify-between gap-3 px-4 py-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cs-brand ${active?.hash === category.hash ? 'bg-cs-brand-subtle' : 'hover:bg-cs-raised'}`}
              >
                <span>
                  <span className="block text-sm font-semibold text-cs-text">{category.label}</span>
                  <span className={compact ? 'mt-0.5 hidden text-xs text-cs-text-2 md:block' : 'mt-0.5 block text-xs text-cs-text-2'}>{category.description}</span>
                </span>
                <span aria-hidden="true" className="text-cs-muted">›</span>
              </Link>
            ))}
          </Card>
        </nav>

        <div hidden={!active} className="min-w-0 space-y-2">
          {!compact && <Link to={{ pathname, search }} className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-cs-brand dark:text-rose-300 md:hidden">
            <span aria-hidden="true">‹</span> Back to {title}
          </Link>}
          <div ref={panelRef} tabIndex={-1} role="region" aria-label={panelLabel ?? active?.label} className="min-w-0 space-y-4 outline-none!">
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

import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Card } from './ui/Card.tsx'

type SectionCategory = { hash: string; label: string; description: string }

export function SectionNavigation({
  title, categories, active, headerContent, indexContent, showBuildVersion, children,
}: {
  title: string
  categories: readonly SectionCategory[]
  active?: SectionCategory
  headerContent?: React.ReactNode
  indexContent?: React.ReactNode
  showBuildVersion?: boolean
  children: React.ReactNode
}) {
  const { pathname, search, hash } = useLocation()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const previousHash = useRef(hash)
  const activeHash = active?.hash

  useEffect(() => {
    if (activeHash) {
      panelRef.current?.focus({ preventScroll: true })
    } else if (previousHash.current !== hash) {
      headingRef.current?.focus({ preventScroll: true })
    }
    if (activeHash || previousHash.current !== hash) window.scrollTo(0, 0)
    previousHash.current = hash
  }, [activeHash, hash])

  return (
    <div className="space-y-4">
      <h1 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-cs-text outline-none!">{title}</h1>
      {headerContent}
      {!active && indexContent}
      <div className={active ? 'md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:items-start md:gap-5' : 'max-w-xl'}>
        <nav aria-label={`${title} categories`} className={active ? 'hidden md:sticky md:top-28 md:block' : ''}>
          <Card pad="none" className="divide-y divide-cs-border overflow-hidden">
            {categories.map(category => (
              <Link
                key={category.hash}
                to={{ pathname, search, hash: category.hash }}
                aria-current={active?.hash === category.hash ? 'location' : undefined}
                className={`flex min-h-14 items-center justify-between gap-3 px-4 py-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cs-brand ${active?.hash === category.hash ? 'bg-cs-brand-subtle' : 'hover:bg-cs-raised'}`}
              >
                <span>
                  <span className="block text-sm font-semibold text-cs-text">{category.label}</span>
                  <span className="mt-0.5 block text-xs text-cs-text-2">{category.description}</span>
                </span>
                <span aria-hidden="true" className="text-cs-muted">›</span>
              </Link>
            ))}
          </Card>
        </nav>

        <div hidden={!active} className="min-w-0 space-y-2">
          <Link to={{ pathname, search }} className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-cs-brand dark:text-rose-300 md:hidden">
            <span aria-hidden="true">‹</span> Back to {title}
          </Link>
          <div ref={panelRef} tabIndex={-1} role="region" aria-label={active?.label} className="min-w-0 space-y-4 outline-none!">
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

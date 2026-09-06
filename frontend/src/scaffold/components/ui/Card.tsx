import type { ReactNode } from 'react'
import { cardClass, type CardPad } from './cardShell.ts'

/**
 * Base surface card — the app's default content container.
 * `pad` picks the content inset; `pad="none"` is for a child that needs to
 * reach the edge (a chart, or a table that scrolls inside the card).
 */
export function Card({
  children,
  className = '',
  pad = 'responsive',
  as: Tag = 'div',
  tabIndex,
}: {
  children: ReactNode
  className?: string
  pad?: CardPad
  as?: 'div' | 'section'
  /** A card that scrolls its own content needs to be reachable by keyboard. */
  tabIndex?: number
}) {
  return (
    <Tag className={cardClass(pad, className)} tabIndex={tabIndex}>
      {children}
    </Tag>
  )
}

/**
 * Brand hero card — full-bleed gradient surface for the single most
 * important number on a page (portfolio value, stock price, projection
 * range). Accepts a decorative watermark (icon/illustration) positioned
 * top-right, echoing the mockup's shield-in-card motif.
 */
export function HeroCard({
  children,
  className = '',
  watermark,
}: {
  children: ReactNode
  className?: string
  watermark?: ReactNode
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-br from-cs-brand to-cs-brand-hover p-5 text-white shadow-card-brand ${className}`}
    >
      {/* Scrim: dark mode's brand red is bright enough that white text on its own
          falls under WCAG AA (4.5:1) against it. A flat, uniform wash keeps every line
          of text in this card safely above 4.5:1 in both themes, without darkening the
          cs-brand token used everywhere else (buttons, nav pills). Text inside HeroCard
          should stay solid `text-white` (no opacity modifiers) — that's what this scrim
          is calibrated against. */}
      <div className="pointer-events-none absolute inset-0 bg-black/15" />
      {watermark && (
        <div className="pointer-events-none absolute -right-4 -top-4 opacity-15">
          {watermark}
        </div>
      )}
      <div className="relative">{children}</div>
    </div>
  )
}

const TILE_TONES = {
  brand: 'bg-cs-brand-subtle text-cs-brand',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
} as const

export type TileTone = keyof typeof TILE_TONES

/**
 * Square icon badge with a soft tinted background — the mockup's colored icon tiles.
 * `className` fully replaces the default size/radius (rather than appending) so callers
 * can safely resize it without relying on Tailwind's class-order cascade.
 */
export function IconTile({ tone = 'brand', children, className }: { tone?: TileTone; children: ReactNode; className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center ${className ?? 'h-10 w-10 rounded-xl'} ${TILE_TONES[tone]}`}>
      {children}
    </div>
  )
}

/**
 * Uppercase eyebrow label used above section headings and hero figures.
 * Full-opacity `text-cs-text-2` — not a translucent variant — since axe flagged
 * an earlier `/80` version as failing WCAG AA color-contrast on the Login page.
 */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-xs font-semibold uppercase tracking-wide text-cs-text-2 ${className}`}>{children}</p>
}

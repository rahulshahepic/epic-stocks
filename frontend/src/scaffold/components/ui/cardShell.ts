/**
 * The card surface, as classes — for the few cards that are a `button` or a
 * `label` and carry their own handlers. Everything else uses `<Card>`.
 */
const CARD_SHELL = 'rounded-2xl border border-cs-border bg-cs-surface shadow-card'

/**
 * The content insets a card is allowed to have.
 *
 * Every inset in the app is named here rather than passed through className,
 * because a card's padding cannot be overridden that way: Tailwind emits .p-3
 * before .p-4, so `className="p-3"` on a p-4 card loses the tie and silently
 * renders p-4. Anything needing a different inset asks for `pad="none"`.
 */
const CARD_PADS = {
  /** The design-system inset: tighter on a phone, roomier from `sm` up. */
  responsive: 'p-4 sm:p-5',
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
} as const

export type CardPad = keyof typeof CARD_PADS

export function cardClass(pad: CardPad = 'responsive', className = ''): string {
  return `${CARD_SHELL} ${CARD_PADS[pad]} ${className}`
}

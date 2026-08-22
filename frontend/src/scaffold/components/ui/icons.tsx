/**
 * Lightweight inline-SVG icon set + decorative illustrations.
 * No icon library dependency — flat, single-color, stroke-based glyphs
 * that inherit `currentColor` so they tint with their surrounding badge.
 */

type IconProps = { className?: string }

const base = 'h-5 w-5'

export function IconTrendUp({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M3 17l6-6 4 4 8-9" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 6h6v6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconPieChart({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 2v10l8.5 5A10 10 0 0 0 12 2Z" fill="currentColor" opacity={0.35} />
      <path d="M21 12A9 9 0 1 1 12 3" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <path d="M12 3v9l7.8 4.7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconDocument({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M6 2.5h9l4.5 4.5V21a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      <path d="M14.5 2.5V7a.5.5 0 0 0 .5.5h4.5" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      <path d="M8.5 12.5h7M8.5 16h5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}

export function IconCompass({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx={12} cy={12} r={9} stroke="currentColor" strokeWidth={2} />
      <path d="M15.5 8.5 13 13l-4.5 2.5L11 11l4.5-2.5Z" fill="currentColor" />
    </svg>
  )
}

export function IconShield({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 2.5 4.5 5.5V11c0 5.2 3.2 8.7 7.5 10.5 4.3-1.8 7.5-5.3 7.5-10.5V5.5L12 2.5Z" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      <path d="M8.5 12.2l2.4 2.4 4.6-4.9" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconBell({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M6 10.5a6 6 0 1 1 12 0c0 4 1.2 5.2 1.5 6H4.5c.3-.8 1.5-2 1.5-6Z" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      <path d="M10 19.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}

/**
 * Mountain peak with a summit flag — echoes the welcome-screen hero
 * illustration's skyline so the "journey to the top" motif carries through
 * to the other place in the app that talks about a future destination
 * (the projections hero).
 */
export function IconMountainFlag({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M3 19h8.5L8 12l-2.2 3.5L4.5 14 3 19Z" fill="currentColor" opacity={0.5} />
      <path d="M8 19h13l-6.5-12L11 13l-2-3.2L8 19Z" fill="currentColor" />
      <path d="M14.5 7 V3" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      <path d="M14.5 3.2 18 4.7l-3.5 1.5V3.2Z" fill="currentColor" />
    </svg>
  )
}

export function IconChevronLeft({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Decorative hero illustration for the sign-in screen: a shield mark sitting
 * above a soft mountain skyline with a rising trend-line — echoes the brand
 * shield without relying on any stock imagery.
 */
export function HeroIllustration({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 320 200" fill="none" className={className} role="img" aria-label="">
      <defs>
        <linearGradient id="hero-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cs-brand-subtle)" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
        <linearGradient id="hero-shield" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cs-brand)" />
          <stop offset="100%" stopColor="var(--cs-brand-hover)" />
        </linearGradient>
        <linearGradient id="hero-mtn-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cs-border-strong)" stopOpacity={0.5} />
          <stop offset="100%" stopColor="var(--cs-border-strong)" stopOpacity={0.05} />
        </linearGradient>
        <linearGradient id="hero-mtn-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cs-brand)" stopOpacity={0.22} />
          <stop offset="100%" stopColor="var(--cs-brand)" stopOpacity={0.04} />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="320" height="200" fill="url(#hero-sky)" />

      {/* soft clouds */}
      <ellipse cx="60" cy="40" rx="26" ry="7" fill="var(--cs-border-strong)" opacity={0.25} />
      <ellipse cx="250" cy="30" rx="34" ry="8" fill="var(--cs-border-strong)" opacity={0.2} />

      {/* back mountain range */}
      <path d="M0 150 L40 100 L75 130 L110 80 L150 140 L190 95 L230 145 L270 105 L320 150 V200 H0 Z" fill="url(#hero-mtn-back)" />
      {/* front mountain range */}
      <path d="M0 175 L55 120 L95 155 L140 105 L180 165 L225 125 L270 170 L320 135 V200 H0 Z" fill="url(#hero-mtn-front)" />

      {/* rising trend line over the peaks */}
      <path
        d="M20 168 L75 140 L120 152 L165 108 L205 122 L255 78 L300 60"
        stroke="var(--cs-brand)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity={0.85}
      />
      <circle cx="300" cy="60" r="4" fill="var(--cs-brand)" />

      {/* shield mark */}
      <g transform="translate(128, 18)">
        <path
          d="M32 0 8 10v18c0 20.5 12.7 34.6 24 41 11.3-6.4 24-20.5 24-41V10L32 0Z"
          fill="url(#hero-shield)"
        />
        <path
          d="M32 6 14 14v14c0 16.3 10 27.7 18 32.7C40 55.7 50 44.3 50 28V14L32 6Z"
          fill="none"
          stroke="#fff"
          strokeOpacity={0.25}
          strokeWidth={1}
        />
        <text x="32" y="38" textAnchor="middle" fontSize="26" fontWeight={700} fill="#fff" fontFamily="ui-sans-serif, system-ui, sans-serif">E</text>
      </g>
    </svg>
  )
}

/** Small decorative sparkline used as a watermark inside hero/stat cards. */
export function Sparkline({ className = '', color = 'currentColor' }: IconProps & { color?: string }) {
  return (
    <svg viewBox="0 0 120 40" fill="none" className={className} aria-hidden="true">
      <path
        d="M0 32 L14 26 L28 30 L42 18 L56 22 L70 10 L84 15 L98 4 L120 8"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

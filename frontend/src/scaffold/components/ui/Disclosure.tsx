import type { ComponentProps } from 'react'

export function DisclosureSummary({ className = '', ...props }: ComponentProps<'summary'>) {
  return <summary {...props} className={`cs-disclosure ${className}`} />
}

export function DisclosureButton({ className = '', ...props }: ComponentProps<'button'>) {
  return <button type="button" {...props} className={`cs-disclosure ${className}`} />
}

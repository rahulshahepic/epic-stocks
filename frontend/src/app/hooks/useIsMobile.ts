import { useSyncExternalStore } from 'react'

const SM_BREAKPOINT = 640
const QUERY = `(max-width: ${SM_BREAKPOINT - 1}px)`

function query(): MediaQueryList | null {
  if (typeof window === 'undefined') return null
  try { return window.matchMedia(QUERY) } catch { return null }
}

function subscribe(onChange: () => void): () => void {
  const mql = query()
  if (!mql) return () => {}
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  return query()?.matches ?? false
}

/** True on a viewport narrower than Tailwind's `sm` breakpoint. */
export function useIsMobile(): boolean {
  // The server has no viewport, so it renders the desktop layout.
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

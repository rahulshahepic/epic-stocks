import { useState, useEffect } from 'react'

const SM_BREAKPOINT = 640

function getIsMobile() {
  if (typeof window === 'undefined') return false
  try { return window.matchMedia(`(max-width: ${SM_BREAKPOINT - 1}px)`).matches }
  catch { return false }
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(getIsMobile)
  useEffect(() => {
    let mql: MediaQueryList
    try { mql = window.matchMedia(`(max-width: ${SM_BREAKPOINT - 1}px)`) }
    catch { return }
    setIsMobile(mql.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return isMobile
}

import { useEffect, useRef } from 'react'
import { isLoggedIn } from '../../api.ts'

// Don't hammer the server on rapid tab toggles — only refresh if it's been
// at least this long since the last refresh.
const REFRESH_THROTTLE_MS = 60 * 60 * 1000  // 1 hour

/** Sliding session refresh: re-issue the JWT cookie on app mount and when the
 *  PWA returns to the foreground. Active users effectively never expire;
 *  inactive sessions still hit the cookie max_age. Refresh failures are
 *  silent — apiFetch will redirect to /login on the next 401. */
export function useSessionRefresh() {
  const lastRefreshRef = useRef<number>(0)

  useEffect(() => {
    function maybeRefresh() {
      if (!isLoggedIn()) return
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastRefreshRef.current < REFRESH_THROTTLE_MS) return
      lastRefreshRef.current = now
      fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }).catch(() => {})
    }

    maybeRefresh()
    document.addEventListener('visibilitychange', maybeRefresh)
    return () => document.removeEventListener('visibilitychange', maybeRefresh)
  }, [])
}

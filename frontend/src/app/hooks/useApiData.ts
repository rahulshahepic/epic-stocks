import { useState, useEffect, useCallback, useRef } from 'react'
import { useToast } from '../../scaffold/components/toastContext.ts'

export function useApiData<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false })

  const load = useCallback(() => {
    // Cancel any previous in-flight request so stale navigations don't
    // keep server connections open unnecessarily.
    cancelRef.current.cancelled = true
    const token = { cancelled: false }
    cancelRef.current = token

    setLoading(true)
    setError(null)
    fetcher()
      .then(result => { if (!token.cancelled) setData(result) })
      .catch((e: unknown) => {
        if (token.cancelled) return
        const msg = e instanceof Error ? e.message : 'Fetch failed'
        setError(msg)
        toast(msg)
      })
      .finally(() => { if (!token.cancelled) setLoading(false) })
  }, [fetcher, toast])

  useEffect(() => {
    // `load` sets loading/error before it fetches, which this rule reads as a
    // cascading render. On mount it is neither: both are already at those
    // values, so React bails out without re-rendering. When `fetcher` changes
    // — the account being viewed switched — the reset is the point: it puts the
    // spinner back while the new account's data is on its way. Deriving
    // `loading` instead would mean tracking which fetcher the settled state
    // belongs to, in a hook every page depends on, to remove one render that
    // the interface wants.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    return () => { cancelRef.current.cancelled = true }
  }, [load])

  return { data, loading, error, reload: load }
}

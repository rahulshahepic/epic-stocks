import { useState, useEffect, useCallback, useRef } from 'react'
import { useToast } from '../components/Toast.tsx'

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
    load()
    return () => { cancelRef.current.cancelled = true }
  }, [load])

  return { data, loading, error, reload: load }
}

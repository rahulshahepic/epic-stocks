import { useState, useEffect, useCallback } from 'react'
import { useToast } from '../components/Toast.tsx'

export function useApiData<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetcher()
      .then(setData)
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Fetch failed'
        setError(msg)
        toast(msg)
      })
      .finally(() => setLoading(false))
  }, [fetcher, toast])

  useEffect(() => { load() }, [load])

  return { data, loading, error, reload: load }
}

import { useState, useEffect, useCallback } from 'react'

export function useApiData<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetcher()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Fetch failed'))
      .finally(() => setLoading(false))
  }, [fetcher])

  useEffect(() => { load() }, [load])

  return { data, loading, error, reload: load }
}

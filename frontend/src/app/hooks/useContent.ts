import { useEffect, useState } from 'react'
import { api } from '../../api.ts'
import type { ContentBlob } from '../../api.ts'

let cached: ContentBlob | null = null
let inflight: Promise<ContentBlob> | null = null

export function resetContentCache() {
  cached = null
  inflight = null
}

/** Test-only: preload the cache so useContent() returns synchronously on first render. */
export function setContentCacheForTesting(value: ContentBlob) {
  cached = value
  inflight = null
}

/** Global wizard content (grant schedule, rates, refi chains, settings).
 *  Module-scoped singleton — one fetch per session, cached thereafter.
 *  Returns null while loading.
 */
export function useContent(): ContentBlob | null {
  const [content, setContent] = useState<ContentBlob | null>(cached)

  useEffect(() => {
    if (cached) {
      setContent(cached)
      return
    }
    if (!inflight) {
      inflight = api.getContent()
        .then(data => {
          cached = data
          return data
        })
        .catch(err => {
          inflight = null
          throw err
        })
    }
    let cancelled = false
    inflight.then(data => {
      if (!cancelled) setContent(data)
    }).catch(() => { /* leave content as null; caller renders a fallback */ })
    return () => { cancelled = true }
  }, [])

  return content
}

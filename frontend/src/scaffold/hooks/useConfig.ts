import { useEffect, useState } from 'react'

interface AppConfig {
  vapid_public_key: string
  email_notifications_available: boolean
  resend_from: string
  epic_mode: boolean
}

let cached: AppConfig | null = null
let inflight: Promise<AppConfig> | null = null
// Every mounted useConfig() consumer with cached === null registers here, so
// whichever component's effect happens to trigger the fetch, every other
// waiting consumer still gets notified when it resolves — no consumer can be
// left stuck on a stale `if (cached) return` check that skipped its own
// setConfig call because another component's identical fetch got there first.
const subscribers = new Set<(config: AppConfig) => void>()

export function resetConfigCache() {
  cached = null
  inflight = null
}

function fetchConfig(): Promise<AppConfig> {
  if (inflight) return inflight
  inflight = fetch('/api/config')
    .then(r => r.json())
    .then(data => ({
      vapid_public_key: data.vapid_public_key || '',
      email_notifications_available: !!data.email_notifications_available,
      resend_from: data.resend_from || '',
      epic_mode: !!data.epic_mode,
    }))
    .catch(() => ({ vapid_public_key: '', email_notifications_available: false, resend_from: '', epic_mode: false }))
    .then(config => {
      cached = config
      inflight = null
      subscribers.forEach(notify => notify(config))
      return config
    })
  return inflight
}

export function useConfig() {
  const [config, setConfig] = useState<AppConfig | null>(cached)

  useEffect(() => {
    if (cached) return
    subscribers.add(setConfig)
    fetchConfig()
    return () => { subscribers.delete(setConfig) }
  }, [])

  return config
}

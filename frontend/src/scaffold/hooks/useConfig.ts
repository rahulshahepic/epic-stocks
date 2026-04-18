import { useEffect, useState } from 'react'

interface AppConfig {
  vapid_public_key: string
  email_notifications_available: boolean
  resend_from: string
  epic_mode: boolean
}

let cached: AppConfig | null = null

export function resetConfigCache() {
  cached = null
}

export function useConfig() {
  const [config, setConfig] = useState<AppConfig | null>(cached)

  useEffect(() => {
    if (cached) return
    fetch('/api/config')
      .then(r => r.json())
      .then(data => {
        cached = {
          vapid_public_key: data.vapid_public_key || '',
          email_notifications_available: !!data.email_notifications_available,
          resend_from: data.resend_from || '',

          epic_mode: !!data.epic_mode,
        }
        setConfig(cached)
      })
      .catch(() => {
        cached = { vapid_public_key: '', email_notifications_available: false, resend_from: '', epic_mode: false }
        setConfig(cached)
      })
  }, [])

  return config
}

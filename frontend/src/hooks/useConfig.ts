import { useEffect, useState } from 'react'

interface AppConfig {
  google_client_id: string
  vapid_public_key: string
  email_notifications_available: boolean
  epic_onboarding_url: string
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
          google_client_id: data.google_client_id || '',
          vapid_public_key: data.vapid_public_key || '',
          email_notifications_available: !!data.email_notifications_available,
          epic_onboarding_url: data.epic_onboarding_url || '',
        }
        setConfig(cached)
      })
      .catch(() => {
        cached = { google_client_id: '', vapid_public_key: '', email_notifications_available: false, epic_onboarding_url: '' }
        setConfig(cached)
      })
  }, [])

  return config
}

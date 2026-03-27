import { useEffect, useState } from 'react'

interface AppConfig {
  auth_provider: string        // 'google' | 'azure_entra'
  vapid_public_key: string
  email_notifications_available: boolean
  resend_from: string
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
          auth_provider: data.auth_provider || 'google',
          vapid_public_key: data.vapid_public_key || '',
          email_notifications_available: !!data.email_notifications_available,
          resend_from: data.resend_from || '',
          epic_onboarding_url: data.epic_onboarding_url || '',
        }
        setConfig(cached)
      })
      .catch(() => {
        cached = { auth_provider: 'google', vapid_public_key: '', email_notifications_available: false, resend_from: '', epic_onboarding_url: '' }
        setConfig(cached)
      })
  }, [])

  return config
}

import { useEffect, useState } from 'react'

interface AppConfig {
  google_client_id: string
  privacy_url: string
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
          privacy_url: data.privacy_url || '',
        }
        setConfig(cached)
      })
      .catch(() => {
        cached = { google_client_id: '', privacy_url: '' }
        setConfig(cached)
      })
  }, [])

  return config
}

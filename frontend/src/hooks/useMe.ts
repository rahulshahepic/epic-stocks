import { useState, useEffect } from 'react'
import { api } from '../api.ts'

interface MeData {
  id: number
  email: string
  name: string
  is_admin: boolean
}

let cached: MeData | null = null

export function resetMeCache() {
  cached = null
}

export function useMe() {
  const [me, setMe] = useState<MeData | null>(cached)

  useEffect(() => {
    if (cached) return
    api.getMe()
      .then(data => { cached = data; setMe(data) })
      .catch(() => {})
  }, [])

  return me
}

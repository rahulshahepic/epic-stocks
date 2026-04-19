import { useState, useEffect } from 'react'
import { api } from '../../api.ts'
import type { SharedAccount } from '../../api.ts'

interface MeData {
  id: number
  email: string
  name: string
  is_admin: boolean
  is_content_admin: boolean
  shared_accounts?: SharedAccount[]
}

let cached: MeData | null = null

export function resetMeCache() {
  cached = null
}

const USER_SCOPED_LS_KEYS = [
  'dashboard_range',
  'dashboard_holdingsOpen',
  'dashboard_loansOpen',
  'dashboard_cardDate',
]
const USER_SCOPED_SS_KEYS = ['viewing_context']

/** If the logged-in user changed, purge all user-scoped storage. */
function purgeIfUserChanged(userId: number) {
  const prev = localStorage.getItem('session_user_id')
  if (prev === String(userId)) return
  // Different user (or first login on this browser) — clear stale data
  if (prev !== null) {
    USER_SCOPED_LS_KEYS.forEach(k => localStorage.removeItem(k))
    USER_SCOPED_SS_KEYS.forEach(k => sessionStorage.removeItem(k))
  }
  localStorage.setItem('session_user_id', String(userId))
}

export function useMe() {
  const [me, setMe] = useState<MeData | null>(cached)

  useEffect(() => {
    if (cached) return
    api.getMe()
      .then(data => {
        purgeIfUserChanged(data.id)
        cached = data
        setMe(data)
      })
      .catch(() => {})
  }, [])

  return me
}

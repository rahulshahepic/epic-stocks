import { useState, useEffect, useCallback } from 'react'
import { api } from '../../api.ts'
import { platform } from '../../platform/index.ts'

export function usePush(vapidPublicKey: string) {
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [supported] = useState(() => platform.push.supported)

  useEffect(() => {
    if (!supported) { setLoading(false); return }
    api.pushStatus()
      .then(data => setSubscribed(data.subscribed))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [supported])

  const subscribe = useCallback(async () => {
    if (!supported || !vapidPublicKey) return
    setLoading(true)
    try {
      const registration = await platform.push.register(vapidPublicKey)
      await api.pushSubscribe(registration)
      setSubscribed(true)
    } catch {
      // permission denied or other error
    } finally {
      setLoading(false)
    }
  }, [supported, vapidPublicKey])

  const unsubscribe = useCallback(async () => {
    if (!supported) return
    setLoading(true)
    try {
      // Tell the backend first: if that fails the device registration is still
      // intact and the user can retry.
      const registration = await platform.push.currentRegistration()
      if (registration) {
        await api.pushUnsubscribe(registration)
        await platform.push.unregister()
      }
      setSubscribed(false)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [supported])

  return { subscribed, loading, supported, subscribe, unsubscribe }
}

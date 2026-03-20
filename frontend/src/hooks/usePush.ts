import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.ts'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export function usePush(vapidPublicKey: string) {
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [supported] = useState(() => 'serviceWorker' in navigator && 'PushManager' in window)

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
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      })
      const json = sub.toJSON()
      await api.pushSubscribe(json)
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
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = reg ? await reg.pushManager.getSubscription() : null
      if (sub) {
        const json = sub.toJSON()
        await api.pushUnsubscribe(json)
        await sub.unsubscribe()
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

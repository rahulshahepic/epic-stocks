import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../../api.ts'
import { platform } from '../../platform/index.ts'

/**
 * Push state for *this device*.
 *
 * A subscription can only be created by the device it belongs to, after that
 * device grants permission, so nothing stored on the account can tell us
 * whether push works here. The account only contributes context: how many
 * devices are subscribed, and whether this person wants push at all.
 */
export type PushState =
  | 'needs-install'  // iOS in a Safari tab — push works only once installed
  | 'unsupported'    // no Notification/PushManager on this device
  | 'blocked'        // permission denied; only device settings can undo it
  | 'off'            // can be enabled here
  | 'on'             // permission granted and this device is subscribed

function endpointOf(registration: Record<string, unknown> | null): string | undefined {
  const endpoint = registration?.endpoint
  return typeof endpoint === 'string' ? endpoint : undefined
}

export function usePush(vapidPublicKey: string) {
  const [supported] = useState(() => platform.push.supported)
  const [permission, setPermission] = useState(() => platform.push.permission())
  const [registeredHere, setRegisteredHere] = useState(false)
  const [totalDevices, setTotalDevices] = useState(0)
  const [intent, setIntentState] = useState(false)
  const [loading, setLoading] = useState(true)
  const healedRef = useRef(false)

  const refresh = useCallback(async () => {
    const registration = supported ? await platform.push.currentRegistration() : null
    const status = await api.pushStatus(endpointOf(registration))
    setRegisteredHere(status.registered_here)
    setTotalDevices(status.total_devices)
    setIntentState(status.intent)
    setPermission(platform.push.permission())
    return status
  }, [supported])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const status = await refresh()
        if (cancelled) return

        // Self-heal: permission is already granted, so resubscribing needs no
        // prompt and no gesture. This recovers a device whose subscription the
        // server dropped or the browser rotated, which otherwise leaves push
        // silently dead with the UI showing it as on.
        if (
          !healedRef.current
          && supported
          && vapidPublicKey
          && platform.push.permission() === 'granted'
          && !status.registered_here
        ) {
          healedRef.current = true
          const registration = await platform.push.register(vapidPublicKey)
          await api.pushSubscribe(registration)
          if (!cancelled) await refresh()
        }
      } catch {
        // Leave the UI on whatever it last knew; the button still works.
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [refresh, supported, vapidPublicKey])

  const enable = useCallback(async () => {
    if (!supported || !vapidPublicKey) return
    setLoading(true)
    try {
      const registration = await platform.push.register(vapidPublicKey)
      await api.pushSubscribe(registration)
      await refresh()
    } catch {
      // Denied, or the push service refused. refresh() reads the permission
      // back so a denial shows as 'blocked' rather than a button that did
      // nothing.
      setPermission(platform.push.permission())
    } finally {
      setLoading(false)
    }
  }, [supported, vapidPublicKey, refresh])

  const disable = useCallback(async () => {
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
      await refresh()
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [supported, refresh])

  /** Record whether to keep offering push on devices that have not been asked. */
  const setIntent = useCallback(async (enabled: boolean) => {
    setIntentState(enabled)
    try {
      await api.pushSetIntent(enabled)
    } catch {
      setIntentState(!enabled)
    }
  }, [])

  let state: PushState
  if (!supported) state = platform.push.isInstalled() ? 'unsupported' : 'needs-install'
  else if (permission === 'denied') state = 'blocked'
  else if (permission === 'granted' && registeredHere) state = 'on'
  else state = 'off'

  return {
    state,
    loading,
    intent,
    /** Subscribed devices other than this one — context, never the toggle. */
    otherDevices: Math.max(0, totalDevices - (registeredHere ? 1 : 0)),
    enable,
    disable,
    setIntent,
  }
}

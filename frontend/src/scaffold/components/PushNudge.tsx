import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useConfig } from '../hooks/useConfig.ts'
import { usePush } from '../hooks/usePush.ts'

/**
 * Offers push on a device that has never been asked, to someone who has
 * enabled it somewhere before.
 *
 * A prompt cannot be raised automatically: Safari only honours
 * Notification.requestPermission() inside a user gesture, so an on-load prompt
 * is a no-op on iOS. The button here is that gesture.
 */
export default function PushNudge() {
  const config = useConfig()
  const push = usePush(config?.vapid_public_key ?? '')
  const [dismissed, setDismissed] = useState(false)
  const location = useLocation()

  const show =
    !dismissed
    && !push.loading
    && !!config?.vapid_public_key
    && push.intent
    && push.state === 'off'
    // Settings already shows this device's state and its own Enable button.
    && location.pathname !== '/settings'

  if (!show) return null

  return (
    <div className="flex items-center justify-between gap-3 bg-cs-raised px-4 py-2">
      <p className="text-xs text-cs-text-2">
        Turn on notifications for this device?
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={() => { void push.enable() }}
          className="rounded-md bg-cs-brand px-3 py-1 text-xs font-medium text-white hover:bg-cs-brand-hover"
        >
          Turn on
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-xs text-cs-text-2 hover:text-cs-text"
        >
          Not now
        </button>
        <button
          onClick={() => { setDismissed(true); void push.setIntent(false) }}
          className="text-xs text-cs-text-2 underline hover:text-cs-text"
        >
          Don't ask again
        </button>
      </div>
    </div>
  )
}

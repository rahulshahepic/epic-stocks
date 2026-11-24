import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type TimelineEvent } from '../../api.ts'
import { useConfig } from '../../scaffold/hooks/useConfig.ts'
import { fmtFullDate } from '../format.ts'

/** A real upcoming event supplies context; settings owns subscription consent. */
export default function ReminderOffer({ event }: { event: TimelineEvent | null }) {
  const config = useConfig()
  const [eligible, setEligible] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem('reminder_offer_dismissed') === '1' } catch { return true }
  })
  const hasEvent = event !== null
  useEffect(() => {
    if (!hasEvent || dismissed || (!config?.email_notifications_available && !config?.vapid_public_key)) return
    let cancelled = false
    Promise.all([
      config.email_notifications_available ? api.getEmailPref() : Promise.resolve({ enabled: false, offers_dismissed: false }),
      config.vapid_public_key ? api.pushStatus() : Promise.resolve({ intent: false, total_devices: 0, offer_dismissed: false }),
    ]).then(([email, push]) => {
      if (!cancelled) setEligible(!email.enabled && !email.offers_dismissed && !push.offer_dismissed && !push.intent && push.total_devices === 0)
    }).catch(() => { if (!cancelled) setEligible(false) })
    return () => { cancelled = true }
  }, [config?.email_notifications_available, config?.vapid_public_key, hasEvent, dismissed])
  if (!event || dismissed || !eligible) return null
  return (
    <section aria-label="Upcoming event reminders" className="rounded-xl border border-cs-border bg-cs-surface p-4">
      <p className="text-sm font-medium text-cs-text">Your next {event.event_type === 'Vesting' ? 'vesting' : 'loan payoff'} is {fmtFullDate(event.date)}.</p>
      <p className="mt-1 text-xs leading-relaxed text-cs-text-2">Choose email or push reminders in Settings. Notification previews omit financial amounts. Nothing is enabled until you choose it there.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <Link to="/settings#notifications" className="rounded-lg bg-cs-brand px-3 py-2 font-medium text-white">Choose reminders</Link>
        <button type="button" onClick={() => {
          setDismissed(true)
          try { localStorage.setItem('reminder_offer_dismissed', '1') } catch { /* dismissal still applies in this view */ }
        }} className="px-2 py-2 text-cs-text-2">Don't offer again on this browser</button>
      </div>
    </section>
  )
}

import { useState } from 'react'
import { measurementAllowed, setMeasurementAllowed } from '../onboarding.ts'

export default function MeasurementChoice() {
  const [enabled, setEnabled] = useState(measurementAllowed)
  return <label className="mt-3 flex items-start gap-2 text-xs text-cs-text-2">
    <input type="checkbox" checked={enabled} disabled={navigator.doNotTrack === '1'} onChange={e => {
      setMeasurementAllowed(e.target.checked)
      setEnabled(measurementAllowed())
    }} />
    Help improve setup (optional). Count import, save and reminder steps together for up to 24 hours, without your identity or financial figures. Off unless you choose it; respects Do Not Track.
  </label>
}

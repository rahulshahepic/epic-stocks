import { useState } from 'react'
import { measurementAllowed, setMeasurementAllowed } from '../onboarding.ts'

export default function MeasurementChoice() {
  const [enabled, setEnabled] = useState(measurementAllowed)
  return <label className="mt-3 flex items-start gap-2 text-xs text-cs-text-2">
    <input type="checkbox" checked={enabled} disabled={navigator.doNotTrack === '1'} onChange={e => {
      setMeasurementAllowed(e.target.checked)
      setEnabled(measurementAllowed())
    }} />
    Share optional onboarding counts. A random key joins this tab’s import, save and reminder steps for up to 24 hours. No identity or financial values; Do Not Track is respected.
  </label>
}

import { useId, useState } from 'react'
import { measurementAllowed, setMeasurementAllowed } from '../onboarding.ts'

export default function MeasurementChoice() {
  const [enabled, setEnabled] = useState(measurementAllowed)
  const details = useId()
  return <label className="mt-3 flex items-start gap-2 text-xs text-cs-text-2">
    <input type="checkbox" aria-label="Help improve setup (optional)" aria-describedby={details} checked={enabled} disabled={navigator.doNotTrack === '1'} onChange={e => {
      setMeasurementAllowed(e.target.checked)
      setEnabled(measurementAllowed())
    }} />
    <span>
      <span className="block font-semibold">Help improve setup (optional)</span>
      <span id={details} className="mt-1 block">
        Let us count which steps you finish so we can see where people get stuck. A temporary ID links your import, save, and reminder steps for up to 24 hours. Site admins and authorized admin AI connections can see totals across users. Counts exclude your identity and financial figures. Do Not Track overrides this setting.
      </span>
    </span>
  </label>
}

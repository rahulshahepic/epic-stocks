import { AdminSection } from './AdminSection.tsx'
import type { TrialFunnelReport } from '../../../api.ts'

/** The /try funnel: anonymous daily counters, nothing about who caused them. */
export function TrialFunnel({ funnel }: { funnel: TrialFunnelReport }) {
  return (
    <AdminSection title={<>No-account preview (/try)</>}
    >
      <p className="mt-1 text-xs text-cs-muted">
        Anonymous daily totals over the last 30 days — three counters per day, nothing about who caused them.
      </p>
      {funnel.previews > 0 ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div>
              <span className="text-cs-muted">Previews computed</span>
              <p className="text-lg font-semibold text-cs-text">{funnel.previews.toLocaleString()}</p>
            </div>
            <div>
              <span className="text-cs-muted">Pressed save</span>
              <p className="text-lg font-semibold text-cs-text">{funnel.save_clicked.toLocaleString()}</p>
            </div>
            <div>
              <span className="text-cs-muted">Signed up with it</span>
              <p className="text-lg font-semibold text-cs-text">{funnel.signups_from_trial.toLocaleString()}</p>
            </div>
            <div>
              <span className="text-cs-muted">Conversion</span>
              <p className="text-lg font-semibold text-cs-text">
                {funnel.conversion_rate != null ? `${(funnel.conversion_rate * 100).toFixed(1)}%` : '—'}
              </p>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[320px] text-left text-xs">
              <thead>
                <tr className="text-cs-muted">
                  <th className="pb-1 pr-3 font-medium">Day</th>
                  <th className="pb-1 pr-3 text-right font-medium">Previews</th>
                  <th className="pb-1 pr-3 text-right font-medium">Saved</th>
                  <th className="pb-1 text-right font-medium">Signed up</th>
                </tr>
              </thead>
              <tbody>
                {funnel.days.map(d => (
                  <tr key={d.day} className="border-t border-cs-border">
                    <td className="py-1 pr-3 text-cs-text-2">{d.day}</td>
                    <td className="py-1 pr-3 text-right tabular-nums text-cs-text">{d.previews}</td>
                    <td className="py-1 pr-3 text-right tabular-nums text-cs-text">{d.save_clicked}</td>
                    <td className="py-1 text-right tabular-nums text-cs-text">{d.signups_from_trial}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="mt-3 text-xs text-cs-muted">No previews computed yet.</p>
      )}
    </AdminSection>
  )
}

import { AdminSection } from './AdminSection.tsx'
import type { TipsReport } from '../../../api.ts'

/** How many people took each kind of tip, and what it saved them. */
export function SmartTips({ tipsReport }: { tipsReport: TipsReport }) {
  return (
    <AdminSection title={<>Smart Tips</>}
    >
      {tipsReport.unique_users_accepted > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <span className="text-cs-muted">Users accepted</span>
            <p className="text-lg font-semibold text-cs-text">{tipsReport.unique_users_accepted}</p>
          </div>
          <div>
            <span className="text-cs-muted">Est. total savings</span>
            <p className="text-lg font-semibold text-cs-text">
              {(tipsReport.total_estimated_savings ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
            </p>
          </div>
          {tipsReport.by_type.map(t => (
            <div key={t.type}>
              <span className="text-cs-muted capitalize">{t.type.replace('_', ' ')}</span>
              <p className="text-lg font-semibold text-cs-text">{t.unique_users}</p>
              <p className="text-xs text-cs-muted">
                {t.total_savings.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} saved
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-cs-muted">No tips accepted yet.</p>
      )}
    </AdminSection>
  )
}

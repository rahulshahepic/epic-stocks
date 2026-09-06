import { AdminSection } from './AdminSection.tsx'
import type { DbTableInfo } from '../../../api.ts'
import { formatBytes } from './format.ts'

/** Per-table row counts and sizes. Empty on SQLite, which does not report them. */
export function DatabaseTables({ dbTables }: { dbTables: DbTableInfo[] }) {
  return (
    <AdminSection title={<>Database Tables</>}
    >
      {dbTables.length === 0 ? (
        <p className="mt-3 text-xs text-cs-text-2">
          Table breakdown is only available on PostgreSQL.
        </p>
      ) : (
        <>
          <div tabIndex={0} className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-cs-border text-left text-cs-text-2 ">
                  <th className="pb-1.5 font-medium">Table</th>
                  <th className="pb-1.5 text-right font-medium">Size</th>
                  <th className="pb-1.5 text-right font-medium">~Rows</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {dbTables.map(t => (
                  <tr key={t.table_name}>
                    <td className="py-1.5 font-mono text-cs-text">{t.table_name}</td>
                    <td className="py-1.5 text-right text-cs-text-2">{formatBytes(t.size_bytes)}</td>
                    <td className="py-1.5 text-right text-cs-muted">
                      {t.row_estimate < 0 ? '?' : t.row_estimate.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-cs-text-2">
            PostgreSQL baseline (~7–8 MB) is included in DB size — system catalogs, template databases, and WAL overhead.
            Row counts are pg_class estimates; they may lag until after a VACUUM ANALYZE.
          </p>
        </>
      )}
    </AdminSection>
  )
}

import { AdminSection } from './AdminSection.tsx'
import { Link } from 'react-router-dom'

/** Links out to the admin-only tools that live on their own pages. */
export function ToolsSection() {
  return (
    <AdminSection title={<>Tools</>}
    >
      <Link
        to="/import-diagnostics"
        className="mt-2 inline-block rounded-md bg-rose-50 px-3 py-1.5 text-xs font-medium text-cs-brand hover:bg-rose-100 dark:bg-rose-900/40 dark:text-rose-300 dark:hover:bg-rose-900/50"
      >
        Import diagnostics
      </Link>
      <p className="mt-2 text-xs text-cs-muted">
        Compare the Epic file importer against a real export. Read-only.
      </p>
    </AdminSection>
  )
}

import { useAppContext } from '../contexts/AppContext.tsx'

/** Pill rendered beside the app name, wherever the name appears.
 *
 * The app is named after an employer with no involvement in it, so the name is
 * never shown bare — this travels with it in the header, on the login page, and
 * on the invitation landing page. Renders nothing when the app sets no badge. */
export default function UnofficialBadge({ className = '' }: { className?: string }) {
 const { appNameBadge } = useAppContext()
 if (!appNameBadge) return null
 return (
 <span
 className={`inline-block whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400 ${className}`}
 >
 {appNameBadge}
 </span>
 )
}

import { useAppContext } from '../contexts/AppContext.tsx'

/** "This is not an official employer app" notice.
 *
 * Rendered on every surface a person can reach before signing in — the login
 * page, an invitation landing page, the privacy policy — so nobody hands over
 * an identity-provider sign-in believing this is a system their employer runs.
 * Renders nothing when the app defines no disclaimer. */
export default function DisclaimerNotice({ className = '' }: { className?: string }) {
 const { appDisclaimerTitle, appDisclaimerBody } = useAppContext()
 if (!appDisclaimerBody) return null
 return (
 <div
 role="note"
 aria-label="Affiliation disclaimer"
 className={`rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-left dark:border-amber-800 dark:bg-amber-950/30 ${className}`}
 >
 {appDisclaimerTitle && (
 <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
 {appDisclaimerTitle}
 </p>
 )}
 <div className="mt-1 space-y-1 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
 {appDisclaimerBody}
 </div>
 </div>
 )
}

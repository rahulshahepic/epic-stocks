import { createContext, useContext } from 'react'

export interface NavItem {
  to: string
  label: string
}

export interface NotifyTemplate {
  label: string
  title: string
  body: string
}

export interface AppContextValue {
  /** Display name shown in header and login page. */
  appName: string
  /** Short tagline shown below the app name on the login page. */
  appTagline: string
  /** Badge rendered beside the app name wherever the name appears. The app is
 * named after an employer it has no affiliation with, so the name never
 * appears bare — this pill travels with it. */
  appNameBadge?: string
  /** Heading of the affiliation disclaimer shown on pre-login pages. */
  appDisclaimerTitle?: string
  /** Body of the affiliation disclaimer shown on pre-login pages. Omit to
 * render no disclaimer at all. */
  appDisclaimerBody?: React.ReactNode
  /** One-line version of the disclaimer, shown in the signed-in footer. */
  appDisclaimerShort?: string
  /** Primary nav items. Admin and Content are appended automatically by Layout. */
  navItems: NavItem[]
  /** Routes hidden when a viewer is browsing someone else's data. */
  viewerHiddenRoutes: Set<string>
  /** Routes hidden when epic_mode is active. */
  epicModeHiddenRoutes: Set<string>
  /** App-specific sections rendered inside the Settings page between
 * Notifications and Sharing. */
  settingsSections?: React.ReactNode
  /** ISO date string for the "Last updated" line in the Privacy Policy. */
  privacyLastUpdated: string
  /** Full body of the "What We Collect" section in the Privacy Policy. */
  privacyDataCollected?: React.ReactNode
  /** Full body of the "Third-party services" subsection in the Privacy Policy. */
  privacyThirdParties?: React.ReactNode
  /** Templates available in the Admin → Send Notification modal.
 * Must always include a "custom" key. */
  notifyTemplates: Record<string, NotifyTemplate>
}

export const APP_CONTEXT_DEFAULTS: AppContextValue = {
  appName: 'App',
  appTagline: 'Sign in to continue',
  navItems: [],
  viewerHiddenRoutes: new Set(),
  epicModeHiddenRoutes: new Set(),
  privacyLastUpdated: '',
  notifyTemplates: {
    custom: { label: 'Custom', title: 'Test from admin', body: 'This is a test notification.' },
  },
}

export const AppContext = createContext<AppContextValue>(APP_CONTEXT_DEFAULTS)

export function useAppContext() {
  return useContext(AppContext)
}

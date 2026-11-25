import { createContext, useContext } from 'react'

import type { ReportSource } from '../../api.ts'

/** Context handed to the dialog when something specific went wrong. */
export interface ReportPrefill {
  source?: ReportSource
  /** The failure text the UI already showed the person. */
  errorMessage?: string
  /** Non-financial, allowlisted import-rule summary. */
  publicSafeSummary?: string
  /** Local originals and inputs from the specific failing workflow. */
  documents?: readonly (File | null | undefined)[]
  workflow?: string
  /** Server correlation id, when the failure carried one. */
  errorRef?: string | null
  /** Seed text for the message box (import findings use this). */
  message?: string
  /** Route to attribute the report to. Defaults to the current one. */
  path?: string
  /** Dialog heading, label and placeholder, for requests that are not a fault. */
  title?: string
  prompt?: string
  placeholder?: string
}

export interface ReportContextValue {
  openReport: (prefill?: ReportPrefill) => void
}

export const ReportContext = createContext<ReportContextValue>({ openReport: () => {} })

export const useReportProblem = () => useContext(ReportContext)

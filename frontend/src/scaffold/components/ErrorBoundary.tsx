import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { getLastErrorRef, logReportEvent } from '../reportLog.ts'
import { ReportDialog } from './ReportProblem.tsx'

interface State {
  error: Error | null
  componentStack: string
  reporting: boolean
}

/**
 * Catches a render crash and gives the person something to do about it.
 *
 * Without this a thrown error unmounts the whole tree and leaves a white
 * screen — the one failure the user can never describe and we can never see,
 * because it never reaches the server. The report raised from here carries the
 * error text and the component stack.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, componentStack: '', reporting: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logReportEvent(`render crash: ${error.message}`)
    this.setState({ componentStack: (info.componentStack ?? '').slice(0, 1500) })
  }

  render() {
    const { error, componentStack, reporting } = this.state
    if (!error) return this.props.children

    const detail = [error.message, componentStack].filter(Boolean).join('\n')

    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <p className="text-base font-semibold text-cs-text">Something broke on this page.</p>
        <p className="mt-2 max-w-sm text-sm text-cs-text-2">
          Nothing you entered was lost. Reloading usually clears it — and telling us what you
          were doing is what gets it fixed.
        </p>
        <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-cs-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-cs-brand-hover"
          >
            Reload the app
          </button>
          <button
            onClick={() => this.setState({ reporting: true })}
            className="rounded-xl border border-cs-border px-4 py-2.5 text-sm font-medium text-cs-text-2 hover:bg-cs-raised"
          >
            Report this
          </button>
        </div>
        <p className="mt-4 max-w-sm break-words font-mono text-[11px] text-cs-muted">{error.message}</p>

        {reporting && (
          <ReportDialog
            prefill={{
              source: 'crash',
              errorMessage: detail.slice(0, 500),
              errorRef: getLastErrorRef(),
              path: window.location.pathname,
            }}
            onClose={() => this.setState({ reporting: false })}
          />
        )}
      </div>
    )
  }
}

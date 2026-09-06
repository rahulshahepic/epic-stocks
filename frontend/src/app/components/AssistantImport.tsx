import { useCallback, useEffect, useState } from 'react'
import { api, type ImportProposal } from '../../api.ts'
import { Card } from '../../scaffold/components/ui/Card.tsx'
import FindingList from './FindingList.tsx'
import ImportWizard from './ImportWizard.tsx'

/**
 * An import an AI assistant prepared, waiting to be reviewed.
 *
 * The connector can stage a draft but never apply one — `epic_import/` requires
 * that acceptance goes through the wizard and never a file, and an assistant
 * transcribing share counts is the case that most wants a human looking at a
 * diff first. So this is a handoff, not a result: Review opens the same wizard
 * an uploaded file opens, prefilled.
 */
export default function AssistantImport() {
  const [proposal, setProposal] = useState<ImportProposal | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api.getImportProposal()
      // A draft without a prefill cannot be reviewed, so it is the same as no
      // draft. Nothing here is load-bearing for the rest of the Import page,
      // and it must not render on a response it does not understand.
      .then((p) => setProposal(Array.isArray(p?.wizard_prefill?.grants) ? p : null))
      .catch(() => setProposal(null))
  }, [])

  useEffect(load, [load])

  async function dismiss() {
    try {
      await api.dismissImportProposal()
      setProposal(null)
      setReviewing(false)
    } catch {
      setError('Could not discard the draft')
    }
  }

  if (!proposal) return null

  if (reviewing) {
    return (
      <Card as="section" pad="md">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-cs-text">
              Import from {proposal.client_name}
            </h3>
            <p className="mt-1 text-xs text-cs-text-2">
              Check every figure before you accept it. Nothing is saved until you
              finish the wizard.
            </p>
          </div>
          <button
            onClick={() => setReviewing(false)}
            className="shrink-0 rounded-md border border-cs-border-strong px-2.5 py-1 text-xs font-medium text-cs-text-2 hover:bg-cs-raised"
          >
            Back
          </button>
        </div>
        {proposal.findings.length > 0 && <FindingList findings={proposal.findings} />}
        <div className="mt-3">
          <ImportWizard prefill={proposal.wizard_prefill} onComplete={dismiss} />
        </div>
      </Card>
    )
  }

  const when = proposal.created_at
    ? new Date(proposal.created_at).toLocaleString(undefined, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    })
    : ''

  return (
    <Card as="section" pad="md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-cs-text">
            {proposal.client_name} prepared an import
          </h3>
          <p className="mt-1 text-xs text-cs-text-2">
            {proposal.grants} {proposal.grants === 1 ? 'grant' : 'grants'} and{' '}
            {proposal.prices} {proposal.prices === 1 ? 'price' : 'prices'}
            {when && <span className="text-cs-muted"> · {when}</span>}
          </p>
          <p className="mt-1.5 text-xs text-cs-muted">
            Nothing has changed yet. Review it in the wizard and accept it there,
            the same as an uploaded file.
          </p>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      {proposal.blocked && (
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          Some checks did not pass. Look at these before accepting.
        </p>
      )}

      {proposal.findings.length > 0 && <FindingList findings={proposal.findings} />}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => setReviewing(true)}
          className="rounded-md bg-cs-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-cs-brand-hover"
        >
          Review import
        </button>
        <button
          onClick={dismiss}
          className="rounded-md border border-cs-border-strong px-3 py-1.5 text-xs font-medium text-cs-text-2 hover:bg-cs-raised"
        >
          Discard
        </button>
      </div>
    </Card>
  )
}

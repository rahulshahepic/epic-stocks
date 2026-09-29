import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type AiConnection, type ImportProposal, type ProposalChangeKind } from '../../api.ts'
import { Card } from '../../scaffold/components/ui/Card.tsx'
import FindingList from './FindingList.tsx'
import ImportWizard from './ImportWizard.tsx'

/** What to paste into a chat to start. Names the connector's guide so the
 *  assistant reads it rather than improvising a format. */
export const STARTER_MESSAGE =
  'Help me get my Epic stock into Epic Stocks. I will share my paperwork — ' +
  'grant letters, Shareworks files or screenshots — or tell you what I remember. ' +
  'Use the Epic Stocks connector: read its import guide, work out a first draft, ' +
  'walk me through what you found in plain English (tell me what you guessed), ' +
  'and then prepare the import for me to review in the app.'

/**
 * The chat path, offered before anything has been staged. It is the easiest
 * way in for someone who does not know what a cost basis is, so it leads the
 * Import page — but only where connections are switched on at all.
 */
export function ChatImportIntro() {
  const [connections, setConnections] = useState<AiConnection[] | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.getAiConnections().then(setConnections).catch(() => setConnections([]))
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(STARTER_MESSAGE)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* the message is on screen to select by hand */ }
  }

  const importers = (connections ?? []).filter(c => c.scopes.includes('import:propose'))
  const connected = connections != null && connections.length > 0

  return (
    <Card as="section" pad="md">
      <h3 className="text-sm font-medium text-cs-text">Let ChatGPT or Claude do it</h3>
      <p className="mt-1 text-xs text-cs-text-2">
        Share your grant letters, Shareworks files or screenshots with your AI
        assistant — or just tell it what you remember. It works out your grants and
        loans, explains what it found in plain words, asks about anything unclear,
        and leaves the result here for you to check. Nothing is saved until you
        accept it.
      </p>

      {connections != null && (
        importers.length > 0 ? (
          <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            ✓ Connected: {importers.map(c => c.client_name).join(', ')}
          </p>
        ) : (
          <p className="mt-2 text-xs text-cs-text-2">
            {connected
              ? 'Your assistant is connected, but was not allowed to prepare imports. '
              : 'First connect your assistant — it takes two minutes. '}
            <Link to="/settings#ai-connections" className="font-medium text-cs-brand hover:underline">
              {connected ? 'Reconnect it and allow imports' : 'Connect ChatGPT or Claude'}
            </Link>
          </p>
        )
      )}

      <div className="mt-3 rounded-md bg-cs-raised p-2.5">
        <p className="text-[11px] font-medium text-cs-text-2">Then start the chat with</p>
        <p className="mt-1 text-xs text-cs-text">{STARTER_MESSAGE}</p>
        <button
          onClick={copy}
          className="mt-2 rounded-md border border-cs-border-strong px-2.5 py-1 text-xs font-medium text-cs-text-2 hover:bg-cs-surface"
        >
          {copied ? 'Copied' : 'Copy message'}
        </button>
      </div>
    </Card>
  )
}

const CHANGE_LABELS: [ProposalChangeKind, string][] = [
  ['grants_added', 'New grants'],
  ['grants_updated', 'Grants that change'],
  ['loans_added', 'New loans'],
  ['loans_updated', 'Loans that change'],
  ['loans_removed', 'Loans that would be removed'],
  ['prices_added', 'New share prices'],
  ['prices_updated', 'Share prices that change'],
  ['grants_kept', 'Kept as they are'],
]

/** What accepting would do, so the review starts from the difference. */
function ChangeSummary({ changes }: { changes: ImportProposal['changes'] }) {
  const rows = CHANGE_LABELS.filter(([k]) => (changes?.[k]?.length ?? 0) > 0)
  if (rows.length === 0) return null
  return (
    <div className="mt-3 space-y-1.5" aria-label="What accepting would change">
      <p className="text-xs font-medium text-cs-text">If you accept</p>
      {rows.map(([k, label]) => (
        <div key={k} className={k === 'loans_removed'
          ? 'rounded-md border border-red-200 bg-red-50 p-2 dark:border-red-800 dark:bg-red-950/30'
          : ''}>
          <p className={`text-[11px] font-medium ${k === 'loans_removed'
            ? 'text-red-700 dark:text-red-400' : 'text-cs-text-2'}`}>{label}</p>
          <ul className="mt-0.5 space-y-0.5 text-xs text-cs-text-2">
            {changes![k]!.map(line => <li key={line}>{line}</li>)}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** The assistant's own guesses, first thing the user sees, so they are checked. */
function Assumptions({ client, items }: { client: string; items: ImportProposal['assumptions'] }) {
  if (!items || items.length === 0) return null
  return (
    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-700 dark:bg-amber-900/30">
      <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
        {client} guessed these — check them
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-800 dark:text-amber-300">
        {items.map((a, i) => (
          <li key={i}>{a.subject && <span className="font-medium">{a.subject}: </span>}{a.note}</li>
        ))}
      </ul>
    </div>
  )
}

/**
 * An import an AI assistant prepared, waiting to be reviewed.
 *
 * The connector can stage a draft but never apply one — `epic_import/` requires
 * that acceptance goes through the wizard and never a file, and an assistant
 * transcribing share counts is the case that most wants a human looking at a
 * diff first. So this is a handoff, not a result: Review opens the same wizard
 * an uploaded file opens, prefilled.
 */
export default function AssistantImport({ showIntro = false }: { showIntro?: boolean }) {
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

  if (!proposal) return showIntro ? <ChatImportIntro /> : null

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
        <Assumptions client={proposal.client_name} items={proposal.assumptions} />
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

      <Assumptions client={proposal.client_name} items={proposal.assumptions} />
      <ChangeSummary changes={proposal.changes} />
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

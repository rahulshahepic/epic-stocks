import { useState } from 'react'
import { api } from '../../../api.ts'
import type { TestNotifyResult } from '../../../api.ts'
import { useConfig } from '../../hooks/useConfig.ts'
import { useAppContext } from '../../contexts/AppContext.tsx'

/**
 * Send one user a test push/email. Everything it edits — the template, the
 * title and body, the in-flight flag and the result — belongs to the dialog and
 * lives here rather than in the page around it.
 */
export function NotifyModal({ user, onClose, onSent, onError }: {
  user: { userId: number; userName: string }
  onClose: () => void
  /** A send writes an error_logs row on failure, so the log wants a refresh. */
  onSent: () => void
  onError: (message: string) => void
}) {
  const config = useConfig()
  const { notifyTemplates } = useAppContext()
  const firstKey = Object.keys(notifyTemplates)[0] ?? 'custom'
  const [template, setTemplate] = useState(firstKey)
  const [title, setTitle] = useState(notifyTemplates[firstKey]?.title ?? '')
  const [body, setBody] = useState(notifyTemplates[firstKey]?.body ?? '')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<TestNotifyResult | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    setResult(null)
    try {
      setResult(await api.adminTestNotify(user.userId, title, body))
      onSent()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to send notification')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg bg-cs-surface p-5 shadow-xl ">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-cs-text">
              Notify — {user.userName}
            </h3>
            <p className="text-xs text-cs-text-2">
              Email from: {config?.resend_from || <span className="text-red-500">RESEND_FROM not set</span>}
            </p>
          </div>
          <button
            onClick={() => onClose()}
            aria-label="Close dialog"
            className="text-cs-text-2 hover:text-cs-text-2 "
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-2">
          <select
            aria-label="Template"
            value={template}
            onChange={e => {
              const tpl = e.target.value
              const tmpl = notifyTemplates[tpl]
              setTemplate(tpl)
              if (tmpl) {
                setTitle(tmpl.title)
                setBody(tmpl.body)
              }
              setResult(null)
            }}
            className="w-full rounded-md border border-cs-border-strong bg-cs-surface px-2 py-1.5 text-xs text-cs-text "
          >
            {Object.entries(notifyTemplates).map(([key, tpl]) => (
              <option key={key} value={key}>{tpl.label}</option>
            ))}
          </select>
          <input
            type="text"
            aria-label="Title"
            value={title}
            onChange={e => { setTitle(e.target.value); setTemplate('custom') }}
            placeholder="Title"
            className="w-full rounded-md border border-cs-border-strong bg-cs-surface px-2 py-1.5 text-xs text-cs-text "
          />
          <textarea
            aria-label="Body"
            value={body}
            onChange={e => { setBody(e.target.value); setTemplate('custom') }}
            placeholder="Body"
            rows={2}
            className="w-full rounded-md border border-cs-border-strong bg-cs-surface px-2 py-1.5 text-xs text-cs-text "
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={sending}
              className="rounded-md bg-cs-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-cs-brand-hover disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
            <button
              type="button"
              onClick={() => onClose()}
              className="rounded-md bg-cs-raised px-3 py-1.5 text-xs font-medium text-cs-text-2 hover:bg-stone-200 dark:hover:bg-stone-700"
            >
              Close
            </button>
          </div>
          {result && (
            <p className="text-xs text-green-700 dark:text-green-300">
              Push: {result.push_sent} sent{result.push_failed > 0 ? `, ${result.push_failed} expired` : ''}.{' '}
              Email: {result.email_sent ? 'sent' : `not sent${result.email_skipped_reason ? ` — ${result.email_skipped_reason}` : ''}`}.
            </p>
          )}
        </form>
      </div>
    </div>
  )
}

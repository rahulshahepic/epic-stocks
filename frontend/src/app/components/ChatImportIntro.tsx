import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type AiConnection } from '../../api.ts'
import { Card } from '../../scaffold/components/ui/Card.tsx'

/** What to paste into a chat to start. Names the connector's guide so the
 *  assistant reads it rather than improvising. */
export const STARTER_MESSAGE =
  'Help me keep my Epic stock up to date in Epic Stocks. I will share my paperwork — ' +
  'purchase agreements, loan statements, Eureka files or screenshots — or tell you what ' +
  'I remember. Use the Epic Stocks connector: read its import guide, preview the changes ' +
  'with apply_changes, walk me through them in plain English (tell me what you guessed), ' +
  'and save them once I say yes.'

/**
 * The chat path: hand your documents to ChatGPT or Claude and let it enter
 * them. Edits need the Equity editing permission on the connection.
 */
export default function ChatImportIntro() {
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

  const editors = (connections ?? []).filter(c => c.scopes.includes('equity:write'))
  const connected = connections != null && connections.length > 0

  return (
    <Card as="section" pad="md">
      <h3 className="text-sm font-medium text-cs-text">Let ChatGPT or Claude do it</h3>
      <p className="mt-1 text-xs text-cs-text-2">
        Give your AI assistant your purchase agreement, loan statement, Eureka files or
        screenshots — or just tell it what you remember. It shows you exactly what it will
        add or change, in plain words, and saves only when you say yes.
      </p>

      {connections != null && (
        editors.length > 0 ? (
          <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            ✓ Connected with editing: {editors.map(c => c.client_name).join(', ')}
          </p>
        ) : (
          <p className="mt-2 text-xs text-cs-text-2">
            {connected
              ? 'Your assistant is connected but cannot edit. '
              : 'First connect your assistant — it takes two minutes. '}
            <Link to={connected ? '/settings#ai-connections' : '/connect-ai'} className="font-medium text-cs-brand hover:underline">
              {connected ? 'Reconnect it with Equity editing ticked' : 'Connect your assistant'}
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

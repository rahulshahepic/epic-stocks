import { useEffect, useState } from 'react'
import { api } from '../../api.ts'
import StarterQuestions from '../../app/components/StarterQuestions.tsx'
import { Navigate } from 'react-router-dom'
import { useConfig } from '../hooks/useConfig.ts'
import { Card } from '../components/ui/Card.tsx'
import { AiConnectionsSection } from '../components/AiConnectionsSection.tsx'
import { useReportProblem } from '../components/reportContext.ts'
import { ASSISTANT_GUIDES, mcpServerUrl, museSetupPrompt } from '../components/connectAiGuides.ts'

const STORAGE_KEY = 'connect-ai-assistant'

function remembered(): string {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value && ASSISTANT_GUIDES.some(g => g.id === value)) return value
  } catch { /* private window */ }
  return ASSISTANT_GUIDES[0].id
}

function CopyButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setState('copied')
        } catch {
          setState('failed')
        }
      }}
      className="shrink-0 rounded-md bg-cs-brand px-3 py-2 text-xs font-semibold text-white dark:bg-[#a80f28] hover:bg-cs-brand-hover"
    >
      {state === 'copied' ? copiedLabel : state === 'failed' ? 'Copy failed — select it' : label}
    </button>
  )
}

/** Connect any supported AI assistant to this account's MCP server. */
export default function ConnectAi() {
  const config = useConfig()
  const { openReport } = useReportProblem()
  const [selected, setSelected] = useState(remembered)
  const serverUrl = mcpServerUrl()
  const staging = window.location.hostname === 'staging.epic-stocks.com' || !!config?.staging_demo
  const guide = ASSISTANT_GUIDES.find(g => g.id === selected) ?? ASSISTANT_GUIDES[0]
  const [questions, setQuestions] = useState<string[]>([])
  useEffect(() => {
    if (!config?.ai_connections) return
    let active = true
    api.getDashboard().then(d => { if (active) setQuestions(d.starter_questions ?? []) }).catch(() => {})
    return () => { active = false }
  }, [config?.ai_connections])

  if (config && !config.ai_connections) return <Navigate to="/settings" replace />

  function choose(id: string) {
    setSelected(id)
    try { localStorage.setItem(STORAGE_KEY, id) } catch { /* private window */ }
  }

  function requestSupport(problem?: string) {
    openReport({
      source: 'request',
      title: problem ? `${guide.name} would not connect` : 'Request an assistant',
      prompt: problem ? 'What happened?' : 'Which assistant, and anything you know about connecting it',
      placeholder: problem
        ? 'The error the assistant showed, and the step you were on'
        : 'e.g. Copilot — it has a custom connector page under Settings',
      message: problem ?? '',
    })
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-cs-text">Connect your AI</h1>
      <StarterQuestions questions={questions} />
      {staging && <Card as="section" pad="md">
        <h2 className="text-sm font-semibold text-cs-text">Staging test connector</h2>
        <p className="mt-2 text-xs text-cs-text-2">Connect as Epic Stocks Staging Test. These downloads use staging OAuth. Ask your assistant to verify the account context and set up a fictional test account before reading or editing. Each connection has its own saved test data, separate from your dashboard and production account.</p>
        <a href="/mcp-setup" className="mt-3 inline-block text-xs font-semibold text-cs-brand dark:text-rose-300 underline">Public staging setup guide</a>
      </Card>}

      <Card as="section" pad="md">
        <h2 className="sr-only">Account connection</h2>
        <p className="text-xs text-cs-text-2">
          Let your AI assistant read your equity — and, if you allow it, set up
          grants and loans from your paperwork. You approve every permission when
          you connect, and can disconnect at any time.
        </p>

        <label htmlFor="mcp-server-url" className="mt-4 block text-xs font-medium text-cs-text">
          Server address
        </label>
        <div className="mt-1 flex items-stretch gap-2">
          <input
            id="mcp-server-url"
            readOnly
            value={serverUrl}
            onFocus={e => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-md border border-cs-border bg-cs-raised px-2.5 py-2 font-mono text-xs text-cs-text"
          />
          <CopyButton text={serverUrl} label="Copy" copiedLabel="Copied" />
        </div>
        <p className="mt-1 text-xs text-cs-muted">
          Streamable HTTP, OAuth sign-in. No API key or client ID is needed.
        </p>

        <label htmlFor="assistant-picker" className="mt-4 block text-xs font-medium text-cs-text">
          Your assistant
        </label>
        <select
          id="assistant-picker"
          value={guide.id}
          onChange={e => choose(e.target.value)}
          className="mt-1 w-full rounded-md border border-cs-border-strong bg-cs-surface px-2.5 py-2 text-sm text-cs-text"
        >
          {ASSISTANT_GUIDES.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>

        <div className="mt-3" aria-live="polite">
          {guide.note && <p className="mb-2 text-xs text-cs-text-2">{guide.note}</p>}
          <ol className="space-y-1.5 text-xs text-cs-text-2">
            {guide.steps.map((step, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-cs-raised text-[10px] font-semibold text-cs-text-2">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          {guide.setupPrompt && (
            <div className="mt-2.5">
              <p className="whitespace-pre-wrap break-words rounded-md bg-cs-raised p-2.5 text-xs text-cs-text">
                {museSetupPrompt(serverUrl)}
              </p>
              <div className="mt-2">
                <CopyButton text={museSetupPrompt(serverUrl)} label={`Copy ${guide.name} setup request`} copiedLabel="Setup request copied" />
              </div>
            </div>
          )}

          {guide.plugin && (
            <p className="mt-2 text-xs text-cs-text-2">
              Or{' '}
              <a className="font-medium text-cs-brand dark:text-rose-300 underline" href={guide.plugin.href} download={staging ? `epic-stocks-staging-test-${guide.id}.zip` : guide.plugin.filename}>
                download the {staging ? 'staging ' : ''}{guide.name} plugin
              </a>{' '}
              and upload the ZIP under {guide.name === 'Claude' ? 'Customize → Plugins' : 'Plugins → + → Upload plugin'} — no address to paste.
            </p>
          )}

          {guide.docs && (
            <a className="mt-2 inline-block text-xs text-cs-brand dark:text-rose-300 underline" href={guide.docs} target="_blank" rel="noopener noreferrer">
              {guide.name}&apos;s own instructions
            </a>
          )}
        </div>

        <p className="mt-3 text-xs text-cs-text-2">
          Once connected, name the connector when you ask — &ldquo;use Epic Stocks:
          what vests in the next six months?&rdquo; Assistants do better when told
          which tool to use.
        </p>
        <p className="mt-1.5 text-xs text-cs-muted">
          Menus move around. If a step does not match, look for &ldquo;Connectors&rdquo;
          or &ldquo;custom MCP&rdquo; in the assistant&apos;s settings.
        </p>
        <p className="mt-1.5 text-xs text-cs-muted">
          Connecting means your figures are sent to {guide.company} when the
          assistant asks for them — the same as pasting them into a chat.
        </p>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-cs-border pt-3">
          <button
            type="button"
            onClick={() => requestSupport(`Connecting ${guide.name} failed: `)}
            className="rounded-md border border-cs-border-strong px-2.5 py-1.5 text-xs font-medium text-cs-text-2 hover:bg-cs-raised"
          >
            {guide.name} would not connect
          </button>
          <button
            type="button"
            onClick={() => requestSupport()}
            className="rounded-md border border-cs-border-strong px-2.5 py-1.5 text-xs font-medium text-cs-text-2 hover:bg-cs-raised"
          >
            Request another assistant
          </button>
        </div>
      </Card>

      <AiConnectionsSection showGuideLink={false} />
    </div>
  )
}

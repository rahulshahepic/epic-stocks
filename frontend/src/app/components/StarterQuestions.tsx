import { useState } from 'react'
import { platform } from '../../platform/index.ts'

export default function StarterQuestions({ questions }: { questions?: string[] }) {
  const [copied, setCopied] = useState('')
  const [error, setError] = useState('')
  if (!questions?.length) return null
  return <section aria-label="Suggested equity questions" className="space-y-3 rounded-2xl border border-cs-border bg-cs-surface p-4">
    <h2 className="text-sm font-semibold text-cs-text">A good next question</h2>
    <p className="text-xs text-cs-text-2">Copy a question into your connected assistant. It will read your figures through Epic Stocks.</p>
    <ul className="space-y-2">{questions.map(q => <li key={q} className="flex items-start gap-3">
      <p className="min-w-0 flex-1 break-words text-sm text-cs-text">{q}</p>
      <button type="button" aria-label={`Copy question: ${q}`} className="min-h-11 shrink-0 rounded-lg border border-cs-border-strong px-3 text-xs font-semibold text-cs-text" onClick={async () => {
        try { if (!await platform.files.copyText(q)) throw new Error(); setCopied(q); setError('') }
        catch { setError('Could not copy. Select the question above instead.') }
      }}>{copied === q ? 'Copied' : 'Copy'}</button>
    </li>)}</ul>
    <p role="status" className="text-xs text-cs-text-2">{error || (copied ? 'Question copied. Paste it into your assistant.' : '')}</p>
  </section>
}

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api } from '../../api.ts'
import { localToday } from '../dateUtils.ts'

export default function TaskOutcome() {
  const location = useLocation()
  const [message, setMessage] = useState('')
  const [summary, setSummary] = useState<string[]>([])
  const [messagePath, setMessagePath] = useState('')
  const sequence = useRef(0)
  useEffect(() => {
    sequence.current++
    let active = true
    const saved = (event: Event) => {
      const title = (event as CustomEvent<string>).detail
      const request = ++sequence.current
      setMessage(title); setMessagePath(location.pathname); setSummary([])
      void api.getDashboardSnapshot(localToday()).then(d => { if (active && sequence.current === request) setSummary(d.summary_sentences ?? []) }).catch(() => {})
    }
    window.addEventListener('equity-task-saved', saved)
    return () => { active = false; window.removeEventListener('equity-task-saved', saved) }
  }, [location.pathname])
  if (!message || messagePath !== location.pathname) return null
  return <section role="status" className="mb-4 space-y-2 rounded-xl border border-cs-border bg-cs-surface p-4 text-sm text-cs-text">
    <div className="flex justify-between gap-3"><h2 className="font-semibold">{message}</h2><button aria-label="Dismiss saved result" onClick={() => { sequence.current++; setMessage('') }} className="min-h-11 px-2 text-xs underline">Dismiss</button></div>
    {summary.slice(0, 3).map(s => <p key={s} className="text-xs text-cs-text-2">{s}</p>)}
    <div className="flex flex-wrap gap-4"><Link to="/" className="min-h-11 py-2 font-semibold text-cs-brand">See updated position →</Link><Link to="/retirement" className="min-h-11 py-2 font-semibold text-cs-brand">Review retirement</Link></div>
  </section>
}

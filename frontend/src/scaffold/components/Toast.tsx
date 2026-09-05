import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { useReportProblem } from './ReportProblem.tsx'

type ToastType = 'error' | 'success' | 'info'

interface Toast {
 id: number
 message: string
 type: ToastType
}

interface ToastContextValue {
 toast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} })

export const useToast = () => useContext(ToastContext)

let nextId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
 const [toasts, setToasts] = useState<Toast[]>([])
 const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
 const { openReport } = useReportProblem()

 const dismiss = useCallback((id: number) => {
 const t = timers.current.get(id)
 if (t) clearTimeout(t)
 timers.current.delete(id)
 setToasts((prev) => prev.filter((t) => t.id !== id))
 }, [])

 const toast = useCallback((message: string, type: ToastType = 'error') => {
 const id = ++nextId
 setToasts((prev) => [...prev.slice(-2), { id, message, type }])
 // An error toast carries a Report action, so give it long enough to be read
 // and acted on rather than the usual glance.
 const timer = setTimeout(() => dismiss(id), type === 'error' ? 9000 : 5000)
 timers.current.set(id, timer)
 }, [dismiss])

 useEffect(() => {
 return () => timers.current.forEach((t) => clearTimeout(t))
 }, [])

 const colors: Record<ToastType, string> = {
 error: 'bg-cs-brand',
 success: 'bg-emerald-700',
 info: 'bg-sky-600 dark:bg-sky-500',
 }

 return (
 <ToastContext.Provider value={{ toast }}>
 {children}
 {/* (F) aria-live region so screen readers announce toasts */}
 <div
 aria-live="polite"
 aria-atomic="false"
 className="fixed bottom-4 left-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
 >
 {toasts.map((t) => (
 <div
 key={t.id}
 role="alert"
 onClick={() => dismiss(t.id)}
 className={`pointer-events-auto animate-slide-up rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${colors[t.type]}`}
 >
 <div className="flex items-start justify-between gap-3">
 <span className="min-w-0 flex-1">{t.message}</span>
 {/* Something failing is the moment a person is willing to say so —
 asking later, from a menu, gets far fewer reports. */}
 {t.type === 'error' && (
 <button
 type="button"
 onClick={(e) => {
 e.stopPropagation()
 dismiss(t.id)
 openReport({ source: 'toast', errorMessage: t.message })
 }}
 className="shrink-0 rounded-md bg-white/20 px-2 py-1 text-xs font-semibold hover:bg-white/30"
 >
 Report
 </button>
 )}
 </div>
 </div>
 ))}
 </div>
 </ToastContext.Provider>
 )
}

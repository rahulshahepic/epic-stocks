import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'

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

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((message: string, type: ToastType = 'error') => {
    const id = ++nextId
    setToasts((prev) => [...prev.slice(-2), { id, message, type }])
    const timer = setTimeout(() => dismiss(id), 5000)
    timers.current.set(id, timer)
  }, [dismiss])

  useEffect(() => {
    return () => timers.current.forEach((t) => clearTimeout(t))
  }, [])

  const colors: Record<ToastType, string> = {
    error: 'bg-red-600 dark:bg-red-700',
    success: 'bg-emerald-600 dark:bg-emerald-700',
    info: 'bg-indigo-600 dark:bg-indigo-700',
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 left-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto animate-slide-up rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${colors[t.type]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

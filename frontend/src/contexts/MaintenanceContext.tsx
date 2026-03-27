import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { api } from '../api.ts'

const MaintenanceContext = createContext(false)

export function useMaintenance() {
  return useContext(MaintenanceContext)
}

export function MaintenanceProvider({ children }: { children: React.ReactNode }) {
  const [maintenance, setMaintenance] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        const s = await api.status()
        if (cancelled) return
        if (maintenance && !s.maintenance) {
          window.location.reload()
          return
        }
        setMaintenance(s.maintenance)
      } catch {
        // Network error: leave current state unchanged
      }
    }

    check()
    const delay = maintenance ? 5_000 : 15_000
    intervalRef.current = setInterval(check, delay)
    return () => {
      cancelled = true
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [maintenance])

  return (
    <MaintenanceContext.Provider value={maintenance}>
      {children}
    </MaintenanceContext.Provider>
  )
}

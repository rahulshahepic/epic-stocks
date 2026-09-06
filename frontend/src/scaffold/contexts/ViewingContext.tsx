import { useState, useCallback, type ReactNode } from 'react'
import { ViewingContext, type ViewingState } from './viewing.ts'

export function ViewingProvider({ children }: { children: ReactNode }) {
  const [viewing, setViewingState] = useState<ViewingState | null>(() => {
    try {
      const stored = sessionStorage.getItem('viewing_context')
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  })

  const setViewing = useCallback((invitationId: number, name: string) => {
    const v = { invitationId, name }
    setViewingState(v)
    sessionStorage.setItem('viewing_context', JSON.stringify(v))
  }, [])

  const clearViewing = useCallback(() => {
    setViewingState(null)
    sessionStorage.removeItem('viewing_context')
  }, [])

  return (
    <ViewingContext.Provider value={{ viewing, setViewing, clearViewing }}>
      {children}
    </ViewingContext.Provider>
  )
}

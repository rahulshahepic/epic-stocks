import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface ViewingState {
  invitationId: number
  name: string
}

interface ViewingContextValue {
  /** null = viewing own data; set = viewing someone else's data */
  viewing: ViewingState | null
  setViewing: (invitationId: number, name: string) => void
  clearViewing: () => void
}

const ViewingContext = createContext<ViewingContextValue>({
  viewing: null,
  setViewing: () => {},
  clearViewing: () => {},
})

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

export function useViewing() {
  return useContext(ViewingContext)
}

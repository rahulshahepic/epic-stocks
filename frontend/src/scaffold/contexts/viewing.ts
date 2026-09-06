import { createContext, useContext } from 'react'

export interface ViewingState {
  invitationId: number
  name: string
}

export interface ViewingContextValue {
  /** null = viewing own data; set = viewing someone else's data */
  viewing: ViewingState | null
  setViewing: (invitationId: number, name: string) => void
  clearViewing: () => void
}

export const ViewingContext = createContext<ViewingContextValue>({
  viewing: null,
  setViewing: () => {},
  clearViewing: () => {},
})

export function useViewing() {
  return useContext(ViewingContext)
}

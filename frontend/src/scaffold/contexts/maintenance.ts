import { createContext, useContext } from 'react'

/** True while the app is in app-managed downtime. */
export const MaintenanceContext = createContext(false)

export function useMaintenance() {
  return useContext(MaintenanceContext)
}

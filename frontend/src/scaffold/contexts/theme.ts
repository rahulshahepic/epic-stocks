import { createContext, useContext } from 'react'

export type Theme = 'light' | 'dark' | 'auto'

export interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
  isDark: boolean
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: 'auto',
  setTheme: () => {},
  isDark: false,
})

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

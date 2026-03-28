import { useTheme } from '../contexts/ThemeContext.tsx'

export function useDark(): boolean {
  return useTheme().isDark
}

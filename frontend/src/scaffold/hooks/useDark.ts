import { useTheme } from '../contexts/theme.ts'

export function useDark(): boolean {
  return useTheme().isDark
}

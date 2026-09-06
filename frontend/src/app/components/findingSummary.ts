import type { Finding } from '../epicImport.ts'

/**
 * Summarise findings as rule ids and severities — never their messages, which
 * quote figures from the person's own statement. The ids are what RULES.md is
 * indexed by, so they are the whole of what a fix needs.
 */
export function summariseFindings(findings: Finding[], blocked = false): string {
  const counts = new Map<string, number>()
  for (const f of findings) {
    const key = `${f.code}(${f.severity})`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const codes = [...counts.entries()]
    .map(([key, n]) => (n > 1 ? `${key} ×${n}` : key))
    .join(', ')
  return `${blocked ? 'blocked import' : 'import findings'}: ${codes || 'none'}`
}

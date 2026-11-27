/**
 * The request a notification deep link (?request=<id>) points at, or null.
 *
 * Approval pushes and emails link to /admin?request=<id>#ai-connections
 * (#825). Kept in its own module: AiConnections.tsx is a component module
 * and react-refresh lint requires those to export only components.
 */
export function targetRequestId(search: string): number | null {
  const raw = new URLSearchParams(search).get('request')
  if (!raw) return null
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

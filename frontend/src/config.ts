/**
 * Origin the API is served from.
 *
 * The default — an empty string — means "same origin as the page". That is how
 * the PWA is deployed: Vite proxies /api in development, and in production Caddy
 * and FastAPI serve both the SPA and /api from one domain. Leaving it unset
 * keeps every request byte-identical to what it was before this indirection.
 *
 * A native shell (Capacitor) loads the bundle from capacitor://localhost or
 * https://localhost, so every /api path would resolve against the WebView's own
 * origin rather than the server. Those builds set VITE_API_BASE to the absolute
 * API origin.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').trim().replace(/\/+$/, '')

/** Resolve an app-relative API path (`/api/grants`) against API_BASE. */
export function apiUrl(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return path
  return API_BASE + path
}

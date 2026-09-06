import { platform } from '../platform/index.ts'

/**
 * Where to go after signing in, when the user did not start at the front door.
 *
 * The only caller today is the OAuth consent flow: an AI assistant sends the
 * browser to /oauth/authorize, which needs a signed-in session, so it bounces
 * through /login?next=… and the user should land back on the consent screen
 * rather than on the dashboard wondering what happened.
 *
 * The destination is a server-rendered route, not a SPA one, so returning to it
 * is a navigation and not a router push.
 */

const NEXT_KEY = 'post_login_next'

/**
 * A same-origin path, or null.
 *
 * Anything else is an open redirect wearing a query parameter: `//evil.com`
 * and `https://evil.com` are both valid values of `next` that a browser would
 * happily follow off this origin.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//')) return null
  if (raw.includes('\\')) return null
  return raw
}

export async function stashNext(raw: string | null | undefined): Promise<void> {
  const next = safeNext(raw)
  if (next) await platform.storage.set(NEXT_KEY, next)
  else await platform.storage.remove(NEXT_KEY)
}

/** Read and clear the stashed destination. */
export async function takeNext(): Promise<string | null> {
  const stored = await platform.storage.get(NEXT_KEY)
  await platform.storage.remove(NEXT_KEY)
  return safeNext(stored)
}

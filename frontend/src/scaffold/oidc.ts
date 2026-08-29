import { api } from '../api.ts'
import { platform } from '../platform/index.ts'

/**
 * OIDC PKCE sign-in, in one place.
 *
 * Login and InviteLanding both used to inline this. It is also the flow a
 * native shell has to replace wholesale — the IdP must open in a system browser
 * and return through a deep link, not a WebView navigation — so it lives behind
 * platform.auth rather than touching window.location directly.
 */

const VERIFIER_KEY = 'pkce_verifier'
const STATE_KEY = 'auth_state'
const PROVIDER_KEY = 'auth_provider'

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(64)
  crypto.getRandomValues(array)
  return b64url(array)
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return b64url(new Uint8Array(digest))
}

/** Begin sign-in: mint PKCE material, stash it, hand off to the IdP. */
export async function startLogin(providerName: string): Promise<void> {
  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
  const state = crypto.randomUUID()

  await platform.storage.set(VERIFIER_KEY, verifier)
  await platform.storage.set(STATE_KEY, state)
  await platform.storage.set(PROVIDER_KEY, providerName)

  const redirectUri = platform.auth.redirectUri()
  const { authorization_url } = await api.getLoginUrl(providerName, challenge, redirectUri, state)
  await platform.auth.openAuthorizationUrl(authorization_url)
}

export interface PendingLogin {
  provider: string | null
  verifier: string | null
  state: string | null
}

/** Read the stashed PKCE material without clearing it. */
export async function readPendingLogin(): Promise<PendingLogin> {
  const [provider, verifier, state] = await Promise.all([
    platform.storage.get(PROVIDER_KEY),
    platform.storage.get(VERIFIER_KEY),
    platform.storage.get(STATE_KEY),
  ])
  return { provider, verifier, state }
}

export async function clearPendingLogin(): Promise<void> {
  await Promise.all([
    platform.storage.remove(VERIFIER_KEY),
    platform.storage.remove(STATE_KEY),
    platform.storage.remove(PROVIDER_KEY),
  ])
}

/** Exchange the authorization code and record whatever credential comes back. */
export async function completeLogin(
  provider: string,
  code: string,
  verifier: string,
): Promise<void> {
  const result = await api.exchangeCode(provider, code, verifier, platform.auth.redirectUri())
  await platform.auth.onSessionEstablished(result?.access_token)
}

/**
 * Capability interfaces that differ between the PWA and a native shell.
 *
 * Feature code depends only on these; the implementation is chosen once in
 * platform/index.ts. Adding iOS/Android means adding an implementation here,
 * not touching pages, hooks, or api.ts.
 */

/** Whatever the device hands back when registering for push. */
export type PushRegistration = Record<string, unknown>

export interface AuthPlatform {
  /**
   * Whether a session is believed to exist, without a round trip.
   *
   * Deliberately synchronous: RequireAuth reads it during render. A native
   * implementation caches the token in memory at boot rather than making this
   * async, which would force a loading state through the whole route tree.
   */
  isLoggedIn(): boolean

  /** Headers attached to every API request (a Bearer token on native). */
  authHeaders(): Record<string, string>

  /** Whether cookies ride along with API requests. */
  readonly credentials: RequestCredentials

  /**
   * Record the credential returned by a successful login.
   * The web sets an HttpOnly cookie server-side, so there is nothing to keep.
   */
  onSessionEstablished(token?: string): Promise<void>

  /** Drop any locally held credential. Called on logout. */
  clearSession(): Promise<void>

  /** The redirect_uri handed to the IdP and to the backend for validation. */
  redirectUri(): string

  /** Send the user to the IdP. Native uses a system browser, not the WebView. */
  openAuthorizationUrl(url: string): Promise<void>

  /** Bounce the user to the login screen after a 401. */
  onUnauthorized(): void
}

export interface StoragePlatform {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

export interface FilesPlatform {
  /** Hand a generated file to the user. */
  saveBlob(blob: Blob, filename: string): Promise<void>
  saveText(text: string, filename: string, type?: string): Promise<void>
  /** Copy text to the clipboard. Returns false if the platform refused. */
  copyText(text: string): Promise<boolean>
}

export interface PushPlatform {
  /** Whether this device can receive push at all. */
  readonly supported: boolean
  /** Register with the push service; the payload is posted to the backend. */
  register(vapidPublicKey: string): Promise<PushRegistration>
  /**
   * The current registration payload, without tearing it down.
   *
   * Split from unregister() so callers can tell the backend to forget the
   * subscription *before* the device drops it — if that request fails the
   * device registration is still intact and the user can retry.
   */
  currentRegistration(): Promise<PushRegistration | null>
  /** Tear down the device-side registration. */
  unregister(): Promise<void>
}

export interface Platform {
  readonly name: 'web' | 'ios' | 'android'
  readonly auth: AuthPlatform
  readonly storage: StoragePlatform
  readonly files: FilesPlatform
  readonly push: PushPlatform
}

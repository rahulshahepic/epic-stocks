import type {
  AuthPlatform, FilesPlatform, Platform, PushPermission, PushRegistration, PushPlatform,
  StoragePlatform,
} from './types.ts'

const AUTH_HINT_COOKIE = 'auth_hint='

const auth: AuthPlatform = {
  // The session itself is an HttpOnly cookie the browser attaches for us; the
  // readable auth_hint cookie only mirrors its presence.
  isLoggedIn: () => document.cookie.split(';').some(c => c.trim().startsWith(AUTH_HINT_COOKIE)),
  authHeaders: () => ({}),
  credentials: 'include',
  onSessionEstablished: async () => {},
  clearSession: async () => {},
  redirectUri: () => window.location.origin + '/auth/callback',
  openAuthorizationUrl: async (url: string) => { window.location.href = url },
  onUnauthorized: () => { window.location.href = '/login' },
}

// PKCE material lives in sessionStorage: scoped to the tab that started the
// sign-in and cleared when it closes.
const storage: StoragePlatform = {
  get: async key => { try { return sessionStorage.getItem(key) } catch { return null } },
  set: async (key, value) => { try { sessionStorage.setItem(key, value) } catch { /* private mode */ } },
  remove: async key => { try { sessionStorage.removeItem(key) } catch { /* private mode */ } },
}

const files: FilesPlatform = {
  saveBlob: async (blob, filename) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  },
  saveText: async (text, filename, type = 'text/plain') => {
    await files.saveBlob(new Blob([text], { type }), filename)
  },
  copyText: async text => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  },
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

const push: PushPlatform = {
  get supported() {
    // Notification is the reliable discriminator on iOS: it is absent in a
    // Safari tab, where push cannot work however present PushManager looks.
    return typeof navigator !== 'undefined'
      && 'serviceWorker' in navigator
      && typeof window !== 'undefined'
      && 'PushManager' in window
      && 'Notification' in window
  },
  permission: (): PushPermission => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
    try {
      return Notification.permission
    } catch {
      return 'unsupported'
    }
  },
  isInstalled: () => {
    if (typeof window === 'undefined') return false
    // iOS exposes navigator.standalone; everyone else answers display-mode.
    const iosStandalone = (navigator as { standalone?: boolean }).standalone === true
    try {
      return iosStandalone || window.matchMedia('(display-mode: standalone)').matches
    } catch {
      return iosStandalone
    }
  },
  register: async (vapidPublicKey: string): Promise<PushRegistration> => {
    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
    })
    return sub.toJSON() as PushRegistration
  },
  currentRegistration: async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    return sub ? (sub.toJSON() as PushRegistration) : null
  },
  unregister: async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (sub) await sub.unsubscribe()
  },
}

export const webPlatform: Platform = { name: 'web', auth, storage, files, push }

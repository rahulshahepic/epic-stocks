const TOKEN_KEY = 'auth_token'

export class ConflictError extends Error {
  currentVersion: number
  constructor(currentVersion: number) {
    super('modified_elsewhere')
    this.name = 'ConflictError'
    this.currentVersion = currentVersion
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...Object.fromEntries(new Headers(init?.headers).entries()),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  if (init?.body && typeof init.body === 'string') {
    headers['Content-Type'] = 'application/json'
  }

  const resp = await fetch(path, { ...init, headers })

  if (resp.status === 401) {
    clearToken()
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }

  if (resp.status === 409) {
    let currentVersion = 0
    try {
      const body = await resp.json()
      if (typeof body?.current_version === 'number') currentVersion = body.current_version
    } catch { /* no json body */ }
    throw new ConflictError(currentVersion)
  }

  if (!resp.ok) {
    let detail = `Error ${resp.status}`
    try {
      const body = await resp.json()
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch { /* no json body */ }
    throw new Error(detail)
  }

  if (resp.status === 204) return undefined as T

  return resp.json()
}

// --- Types ---

export interface DashboardData {
  current_price: number
  total_shares: number
  total_income: number
  total_cap_gains: number
  total_loan_principal: number
  next_event: { date: string; event_type: string } | null
}

export interface TimelineEvent {
  date: string
  grant_year: number | null
  grant_type: string | null
  event_type: string
  granted_shares: number | null
  grant_price: number | null
  exercise_price: number | null
  vested_shares: number | null
  price_increase: number
  share_price: number
  cum_shares: number
  income: number
  cum_income: number
  vesting_cap_gains: number
  price_cap_gains: number
  total_cap_gains: number
  cum_cap_gains: number
}

export interface GrantEntry {
  id: number
  year: number
  type: string
  shares: number
  price: number
  vest_start: string
  periods: number
  exercise_date: string
  dp_shares: number
  version: number
}

export interface PriceEntry {
  id: number
  effective_date: string
  price: number
  version: number
}

export interface LoanEntry {
  id: number
  grant_year: number
  grant_type: string
  loan_type: string
  loan_year: number
  amount: number
  interest_rate: number
  due_date: string
  loan_number: string | null
  version: number
}

// --- API ---

function post<T>(path: string, body: object) {
  return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

function put<T>(path: string, body: object) {
  return apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) })
}

function del(path: string) {
  return apiFetch<void>(path, { method: 'DELETE' })
}

export const api = {
  loginGoogle: (token: string) =>
    post<{ access_token: string }>('/api/auth/google', { token }),

  getDashboard: () => apiFetch<DashboardData>('/api/dashboard'),
  getEvents: () => apiFetch<TimelineEvent[]>('/api/events'),

  // Grants
  getGrants: () => apiFetch<GrantEntry[]>('/api/grants'),
  createGrant: (data: Omit<GrantEntry, 'id' | 'version'>) => post<GrantEntry>('/api/grants', data),
  updateGrant: (id: number, data: Partial<Omit<GrantEntry, 'id'>>) => put<GrantEntry>(`/api/grants/${id}`, data),
  deleteGrant: (id: number) => del(`/api/grants/${id}`),

  // Loans
  getLoans: () => apiFetch<LoanEntry[]>('/api/loans'),
  createLoan: (data: Omit<LoanEntry, 'id' | 'version'>) => post<LoanEntry>('/api/loans', data),
  updateLoan: (id: number, data: Partial<Omit<LoanEntry, 'id'>>) => put<LoanEntry>(`/api/loans/${id}`, data),
  deleteLoan: (id: number) => del(`/api/loans/${id}`),

  // Prices
  getPrices: () => apiFetch<PriceEntry[]>('/api/prices'),
  createPrice: (data: Omit<PriceEntry, 'id' | 'version'>) => post<PriceEntry>('/api/prices', data),
  updatePrice: (id: number, data: Partial<Omit<PriceEntry, 'id'>>) => put<PriceEntry>(`/api/prices/${id}`, data),
  deletePrice: (id: number) => del(`/api/prices/${id}`),

  // Quick flows
  newPurchase: (data: {
    year: number; shares: number; price: number; vest_start: string;
    periods: number; exercise_date: string; dp_shares?: number;
    loan_amount?: number; loan_rate?: number; loan_due_date?: string; loan_number?: string;
  }) => post<{ grant: GrantEntry; loan?: LoanEntry }>('/api/flows/new-purchase', data),

  addBonus: (data: {
    year: number; shares: number; price?: number; vest_start: string;
    periods: number; exercise_date: string;
  }) => post<GrantEntry>('/api/flows/add-bonus', data),

  annualPrice: (data: { effective_date: string; price: number }) =>
    post<PriceEntry>('/api/flows/annual-price', data),

  // User info
  getMe: () => apiFetch<{ id: number; email: string; name: string; is_admin: boolean }>('/api/me'),

  // Push notifications
  pushSubscribe: (subscription: PushSubscriptionJSON) =>
    post<{ id: number; endpoint: string }>('/api/push/subscribe', subscription),
  pushUnsubscribe: (subscription: PushSubscriptionJSON) =>
    apiFetch<void>('/api/push/subscribe', { method: 'DELETE', body: JSON.stringify(subscription) }),
  pushStatus: () => apiFetch<{ subscribed: boolean; subscription_count: number }>('/api/push/status'),

  // Email notifications
  getEmailPref: () => apiFetch<{ enabled: boolean }>('/api/notifications/email'),
  setEmailPref: (enabled: boolean) =>
    put<{ enabled: boolean }>(`/api/notifications/email?enabled=${enabled}`, {}),

  // Account
  resetMyData: () => apiFetch<void>('/api/me/reset', { method: 'POST' }),
  deleteMyAccount: () => apiFetch<void>('/api/me', { method: 'DELETE' }),

  // Admin
  adminStats: () => apiFetch<AdminStats>('/api/admin/stats'),
  adminUsers: (q = '', limit = 10, offset = 0) =>
    apiFetch<AdminUserListResponse>(`/api/admin/users?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`),
  adminDeleteUser: (id: number) => del(`/api/admin/users/${id}`),
  adminListBlocked: () => apiFetch<BlockedEmailEntry[]>('/api/admin/blocked'),
  adminBlockEmail: (email: string, reason: string) =>
    post<BlockedEmailEntry>('/api/admin/blocked', { email, reason }),
  adminUnblock: (id: number) => del(`/api/admin/blocked/${id}`),
  adminErrors: (limit = 50) => apiFetch<ErrorLogEntry[]>(`/api/admin/errors?limit=${limit}`),
  adminClearErrors: () => del('/api/admin/errors'),
  adminTestNotify: (user_id: number, title: string, body: string) =>
    post<TestNotifyResult>('/api/admin/test-notify', { user_id, title, body }),
}

export interface AdminStats {
  total_users: number
  active_users_30d: number
  total_grants: number
  total_loans: number
  total_prices: number
  db_size_bytes: number
}

export interface AdminUser {
  id: number
  email: string
  name: string | null
  is_admin: boolean
  created_at: string
  last_login: string | null
  grant_count: number
  loan_count: number
  price_count: number
}

export interface AdminUserListResponse {
  users: AdminUser[]
  total: number
}

export interface BlockedEmailEntry {
  id: number
  email: string
  reason: string | null
  blocked_at: string
}

export interface ErrorLogEntry {
  id: number
  timestamp: string
  method: string | null
  path: string | null
  error_type: string | null
  error_message: string | null
  traceback: string | null
  user_id: number | null
}

export interface TestNotifyResult {
  push_sent: number
  push_failed: number
  email_sent: boolean
  email_skipped_reason?: string | null
}

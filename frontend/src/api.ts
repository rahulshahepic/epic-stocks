const TOKEN_KEY = 'auth_token'

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

  if (!resp.ok) {
    throw new Error(`API error: ${resp.status}`)
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
}

export interface PriceEntry {
  id: number
  effective_date: string
  price: number
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
  createGrant: (data: Omit<GrantEntry, 'id'>) => post<GrantEntry>('/api/grants', data),
  updateGrant: (id: number, data: Partial<Omit<GrantEntry, 'id'>>) => put<GrantEntry>(`/api/grants/${id}`, data),
  deleteGrant: (id: number) => del(`/api/grants/${id}`),

  // Loans
  getLoans: () => apiFetch<LoanEntry[]>('/api/loans'),
  createLoan: (data: Omit<LoanEntry, 'id'>) => post<LoanEntry>('/api/loans', data),
  updateLoan: (id: number, data: Partial<Omit<LoanEntry, 'id'>>) => put<LoanEntry>(`/api/loans/${id}`, data),
  deleteLoan: (id: number) => del(`/api/loans/${id}`),

  // Prices
  getPrices: () => apiFetch<PriceEntry[]>('/api/prices'),
  createPrice: (data: Omit<PriceEntry, 'id'>) => post<PriceEntry>('/api/prices', data),
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
}

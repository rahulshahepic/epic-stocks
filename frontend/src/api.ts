export class ConflictError extends Error {
  currentVersion: number
  constructor(currentVersion: number) {
    super('modified_elsewhere')
    this.name = 'ConflictError'
    this.currentVersion = currentVersion
  }
}

/** True if the HttpOnly session cookie is present (indicated by the auth_hint cookie). */
export function isLoggedIn(): boolean {
  return document.cookie.split(';').some(c => c.trim().startsWith('auth_hint='))
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...Object.fromEntries(new Headers(init?.headers).entries()),
  }
  if (init?.body && typeof init.body === 'string') {
    headers['Content-Type'] = 'application/json'
  }

  const resp = await fetch(path, { ...init, headers, credentials: 'include' })

  if (resp.status === 401) {
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
      if (body?.detail) {
        if (typeof body.detail === 'string') {
          detail = body.detail
        } else if (Array.isArray(body.detail)) {
          detail = body.detail.map((e: { msg?: string }) => e.msg ?? JSON.stringify(e)).join('; ')
        } else {
          detail = JSON.stringify(body.detail)
        }
      }
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
  total_tax_paid: number
  cash_received: number
  interest_deduction_total?: number
  tax_savings_from_deduction?: number
  loan_payment_by_year: { year: string; payoff_sale: number; cash_in: number }[]
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
  // Loan Payoff enrichment
  loan_db_id?: number | null
  cash_due?: number | null
  covered_by_sale?: boolean
  status?: 'covered' | 'planned' | 'refinanced'
  // Early Loan Payment fields
  loan_id?: number | null
  amount?: number | null
  notes?: string | null
  // Sale event fields
  gross_proceeds?: number | null
  estimated_tax?: number | null
  st_shares?: number | null
  sale_id?: number | null
  // 83(b) election (bonus/free grants with price=0 who elected 83b at grant time)
  election_83b?: boolean
  // Estimated price (Share Price events from projected prices)
  is_estimate?: boolean
  // Projected liquidation
  is_projected?: boolean
  outstanding_loan_principal?: number | null
  unvested_cost_proceeds?: number | null
  // Refinanced loan payoff
  refinanced?: boolean
  // Investment interest deduction (when enabled in settings)
  interest_deduction_applied?: number
  interest_deduction_on_stcg?: number
  interest_deduction_on_ltcg?: number
  adjusted_total_cap_gains?: number
  adjusted_cum_cap_gains?: number
}

export interface ExitSaleSummary {
  date: string
  shares: number
  price_per_share: number
  proceeds: number
  estimated_tax: number
  loan_payoff: number
  net: number
}

export interface ExitSummary {
  vested_shares: number
  share_price: number
  gross_vested: number
  unvested_cost_proceeds: number
  liquidation_tax: number
  outstanding_principal: number
  prior_sales: ExitSaleSummary[]
  prior_sales_net: number
  income_tax: number
  deduction_savings: number
  deduction_years: number[]
  deduction_excluded_years: number[]
  net_cash: number
}

export interface GrantEntry {
  id: number
  version: number
  year: number
  type: string
  shares: number
  price: number
  vest_start: string
  periods: number
  exercise_date: string
  dp_shares: number
  election_83b: boolean
}

export interface PriceEntry {
  id: number
  version: number
  effective_date: string
  price: number
  is_estimate?: boolean
}

export interface LoanEntry {
  id: number
  version: number
  grant_year: number
  grant_type: string
  loan_type: string
  loan_year: number
  amount: number
  interest_rate: number
  due_date: string
  loan_number: string | null
  refinances_loan_id: number | null
}

export interface SmartTip {
  type: 'deduction' | 'method'
  title: string
  description: string
  savings: number
  apply: Record<string, unknown>
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
  // OIDC / PKCE auth flow
  getProviders: () =>
    apiFetch<Array<{ name: string; label: string }>>('/api/auth/providers'),
  getLoginUrl: (provider: string, codeChallenge: string, redirectUri: string, state: string) => {
    const params = new URLSearchParams({ provider, code_challenge: codeChallenge, redirect_uri: redirectUri, state })
    return apiFetch<{ authorization_url: string }>(`/api/auth/login?${params}`)
  },
  exchangeCode: (provider: string, code: string, codeVerifier: string, redirectUri: string) =>
    post<{ access_token: string }>('/api/auth/callback', { provider, code, code_verifier: codeVerifier, redirect_uri: redirectUri }),

  getDashboard: () => apiFetch<DashboardData>('/api/dashboard'),
  getEvents: () => apiFetch<TimelineEvent[]>('/api/events'),

  // Grants
  getGrants: () => apiFetch<GrantEntry[]>('/api/grants'),
  createGrant: (data: Omit<GrantEntry, 'id' | 'version'>) => post<GrantEntry>('/api/grants', data),
  updateGrant: (id: number, data: Partial<Omit<GrantEntry, 'id'>>) => put<GrantEntry>(`/api/grants/${id}`, data),
  deleteGrant: (id: number) => del(`/api/grants/${id}`),

  // Loans
  getLoans: () => apiFetch<LoanEntry[]>('/api/loans'),
  createLoan: (data: Omit<LoanEntry, 'id' | 'version'>, generatePayoffSale = true) =>
    post<LoanEntry>(`/api/loans?generate_payoff_sale=${generatePayoffSale}`, data),
  updateLoan: (id: number, data: Partial<Omit<LoanEntry, 'id'>>, regeneratePayoffSale = false) =>
    put<LoanEntry>(`/api/loans/${id}?regenerate_payoff_sale=${regeneratePayoffSale}`, data),
  deleteLoan: (id: number) => del(`/api/loans/${id}`),
  regenerateAllPayoffSales: () => apiFetch<{ updated: number; created: number }>('/api/loans/regenerate-all-payoff-sales', { method: 'POST' }),
  getLoanPayoffSuggestion: (loanId: number) => apiFetch<LoanPayoffSuggestion>(`/api/loans/${loanId}/payoff-sale-suggestion`),
  executePayoff: (loanId: number) => apiFetch<SaleEntry>(`/api/loans/${loanId}/execute-payoff`, { method: 'POST' }),

  // Loan Payments
  getLoanPayments: (loanId?: number) =>
    apiFetch<LoanPaymentEntry[]>(loanId != null ? `/api/loan-payments?loan_id=${loanId}` : '/api/loan-payments'),
  createLoanPayment: (data: Omit<LoanPaymentEntry, 'id' | 'version'>) =>
    post<LoanPaymentEntry>('/api/loan-payments', data),
  updateLoanPayment: (id: number, data: Partial<Omit<LoanPaymentEntry, 'id'>>) =>
    put<LoanPaymentEntry>(`/api/loan-payments/${id}`, data),
  deleteLoanPayment: (id: number) => del(`/api/loan-payments/${id}`),

  // Prices
  getPrices: () => apiFetch<PriceEntry[]>('/api/prices'),
  createPrice: (data: Omit<PriceEntry, 'id' | 'version' | 'is_estimate'>) => post<PriceEntry>('/api/prices', data),
  updatePrice: (id: number, data: Partial<Omit<PriceEntry, 'id' | 'is_estimate'>>) => put<PriceEntry>(`/api/prices/${id}`, data),
  deletePrice: (id: number) => del(`/api/prices/${id}`),
  growthPrice: (data: { annual_growth_pct: number; first_date: string; through_date: string }) =>
    post<PriceEntry[]>('/api/flows/growth-price', data),

  // Quick flows
  newPurchase: (data: {
    year: number; shares: number; price: number; vest_start: string;
    periods: number; exercise_date: string; dp_shares?: number;
    loan_amount?: number; loan_rate?: number; loan_due_date?: string; loan_number?: string;
    generate_payoff_sale?: boolean;
  }) => post<{ grant: GrantEntry; loan?: LoanEntry }>('/api/flows/new-purchase', data),

  addBonus: (data: {
    year: number; shares: number; price?: number; vest_start: string;
    periods: number; exercise_date: string; election_83b?: boolean;
  }) => post<GrantEntry>('/api/flows/add-bonus', data),

  annualPrice: (data: { effective_date: string; price: number }) =>
    post<PriceEntry>('/api/flows/annual-price', data),

  // User info
  getMe: () => apiFetch<{ id: number; email: string; name: string; is_admin: boolean; is_content_admin: boolean; shared_accounts?: SharedAccount[] }>('/api/me'),

  // Push notifications
  pushSubscribe: (subscription: PushSubscriptionJSON) =>
    post<{ id: number; endpoint: string }>('/api/push/subscribe', subscription),
  pushUnsubscribe: (subscription: PushSubscriptionJSON) =>
    apiFetch<void>('/api/push/subscribe', { method: 'DELETE', body: JSON.stringify(subscription) }),
  pushStatus: () => apiFetch<{ subscribed: boolean; subscription_count: number }>('/api/push/status'),
  pushTest: () => post<{ sent: number }>('/api/push/test', {}),

  // Email notifications
  getEmailPref: () => apiFetch<{ enabled: boolean; advance_days: number }>('/api/notifications/email'),
  setEmailPref: (enabled: boolean) =>
    put<{ enabled: boolean; advance_days: number }>(`/api/notifications/email?enabled=${enabled}`, {}),
  setAdvanceDays: (advance_days: number) =>
    put<{ enabled: boolean; advance_days: number }>(`/api/notifications/advance-days?advance_days=${advance_days}`, {}),

  // Account
  resetMyData: () => apiFetch<void>('/api/me/reset', { method: 'POST' }),
  deleteMyAccount: () => apiFetch<void>('/api/me', { method: 'DELETE' }),

  // Sales
  getSaleLots: (sale_date: string) =>
    apiFetch<SaleLots>(`/api/sales/lots?sale_date=${encodeURIComponent(sale_date)}`),
  getTrancheAllocation: (params: { sale_date: string; shares: number; method: string; grant_year?: number; grant_type?: string }) => {
    const q = new URLSearchParams({ sale_date: params.sale_date, shares: String(params.shares), method: params.method })
    if (params.grant_year != null) q.set('grant_year', String(params.grant_year))
    if (params.grant_type != null) q.set('grant_type', params.grant_type)
    return apiFetch<TrancheAllocation>(`/api/sales/tranche-allocation?${q}`)
  },
  estimateSale: (params: { price_per_share: number; target_net_cash?: number; shares?: number; sale_date?: string; loan_id?: number; grant_year?: number; grant_type?: string }) => {
    const q = new URLSearchParams({
      price_per_share: String(params.price_per_share),
      ...(params.target_net_cash != null ? { target_net_cash: String(params.target_net_cash) } : {}),
      ...(params.shares != null ? { shares: String(params.shares) } : {}),
      ...(params.sale_date != null ? { sale_date: params.sale_date } : {}),
      ...(params.loan_id != null ? { loan_id: String(params.loan_id) } : {}),
      ...(params.grant_year != null ? { grant_year: String(params.grant_year) } : {}),
      ...(params.grant_type != null ? { grant_type: params.grant_type } : {}),
    })
    return apiFetch<SaleEstimate>(`/api/sales/estimate?${q}`)
  },
  getSales: () => apiFetch<SaleEntry[]>('/api/sales'),
  createSale: (data: Omit<SaleEntry, 'id' | 'version'>) => post<SaleEntry>('/api/sales', data),
  updateSale: (id: number, data: Partial<Omit<SaleEntry, 'id'>>) => put<SaleEntry>(`/api/sales/${id}`, data),
  deleteSale: (id: number) => del(`/api/sales/${id}`),
  getSaleTax: (id: number) => apiFetch<TaxBreakdown>(`/api/sales/${id}/tax`),
  getAllSaleTaxes: () => apiFetch<Record<number, TaxBreakdown>>('/api/sales/tax'),

  // Tax Settings
  getTaxSettings: () => apiFetch<TaxSettings>('/api/tax-settings'),
  updateTaxSettings: (data: Partial<TaxSettings>) => put<TaxSettings>('/api/tax-settings', data),

  previewExit: (date: string) => apiFetch<ExitPreview | null>(`/api/preview-exit?date=${encodeURIComponent(date)}`),
  previewDeduction: (enabled: boolean, excludePast = false) =>
    apiFetch<DeductionPreview | null>(`/api/preview-deduction?enabled=${enabled}${excludePast ? '&exclude_past=true' : ''}`),

  // Wizard
  wizardParseFile: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiFetch<WizardParseResult>('/api/wizard/parse-file', { method: 'POST', body: form })
  },
  wizardPreview: (data: WizardSubmitPayload) =>
    post<WizardPreviewResult>('/api/wizard/preview', data),
  wizardSubmit: (data: WizardSubmitPayload) =>
    post<WizardSubmitResult>('/api/wizard/submit', data),

  // Wizard content (read by any logged-in user; writes gated by content-admin)
  getContent: () => apiFetch<ContentBlob>('/api/content'),
  createGrantTemplate: (data: GrantTemplateCreate) =>
    post<{ id: number }>('/api/content/grant-templates', data),
  updateGrantTemplate: (id: number, data: Partial<GrantTemplateCreate>) =>
    put<{ id: number }>(`/api/content/grant-templates/${id}`, data),
  deleteGrantTemplate: (id: number) => del(`/api/content/grant-templates/${id}`),
  createGrantTypeDef: (data: GrantTypeDef) =>
    post<{ name: string }>('/api/content/grant-type-defs', data),
  updateGrantTypeDef: (name: string, data: Partial<GrantTypeDef>) =>
    put<{ name: string }>(`/api/content/grant-type-defs/${encodeURIComponent(name)}`, data),
  deleteGrantTypeDef: (name: string) => del(`/api/content/grant-type-defs/${encodeURIComponent(name)}`),
  createBonusVariant: (data: Omit<BonusScheduleVariant, 'id'>) =>
    post<{ id: number }>('/api/content/bonus-schedule-variants', data),
  updateBonusVariant: (id: number, data: Partial<Omit<BonusScheduleVariant, 'id'>>) =>
    put<{ id: number }>(`/api/content/bonus-schedule-variants/${id}`, data),
  deleteBonusVariant: (id: number) => del(`/api/content/bonus-schedule-variants/${id}`),
  createLoanRate: (data: LoanRateCreate) =>
    post<{ id: number }>('/api/content/loan-rates', data),
  updateLoanRate: (id: number, data: Partial<LoanRateCreate>) =>
    put<{ id: number }>(`/api/content/loan-rates/${id}`, data),
  deleteLoanRate: (id: number) => del(`/api/content/loan-rates/${id}`),
  createLoanRefinance: (data: LoanRefinanceCreate) =>
    post<{ id: number }>('/api/content/loan-refinances', data),
  updateLoanRefinance: (id: number, data: Partial<LoanRefinanceCreate>) =>
    put<{ id: number }>(`/api/content/loan-refinances/${id}`, data),
  deleteLoanRefinance: (id: number) => del(`/api/content/loan-refinances/${id}`),
  updateGrantProgramSettings: (data: Partial<GrantProgramSettings>) =>
    put<{ id: number }>('/api/content/grant-program-settings', data),

  // Admin: content-admin role management
  setContentAdmin: (userId: number, enabled: boolean) =>
    enabled
      ? apiFetch<void>(`/api/admin/users/${userId}/content-admin`, { method: 'POST' })
      : del(`/api/admin/users/${userId}/content-admin`),

  // Smart Tips
  getTips: () => apiFetch<SmartTip[]>('/api/tips'),
  recordTipAcceptance: (tip_type: string, savings_estimate: number) =>
    post<void>('/api/tips/accept', { tip_type, savings_estimate }),

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
  adminMetrics: (hours = 72) => apiFetch<SystemMetricPoint[]>(`/api/admin/metrics?hours=${hours}`),
  adminDbTables: () => apiFetch<DbTableInfo[]>('/api/admin/db-tables'),
  adminTipsReport: () => apiFetch<TipsReport>('/api/admin/tips-report'),

  // Email & invitation admin
  adminEmailLookup: (email: string) =>
    apiFetch<EmailLookupResult>(`/api/admin/email-lookup?email=${encodeURIComponent(email)}`),
  adminUserDetail: (id: number) => apiFetch<UserDetail>(`/api/admin/users/${id}/detail`),
  adminClearOptOut: (id: number) => del(`/api/admin/opt-outs/${id}`),
  adminClearOptOutByEmail: (email: string) =>
    del(`/api/admin/opt-outs?email=${encodeURIComponent(email)}`),
  adminBlockSending: (userId: number, reason: string) =>
    post<{ blocked: boolean }>(`/api/admin/users/${userId}/block-sending`, { reason }),
  adminUnblockSending: (userId: number) =>
    del(`/api/admin/users/${userId}/block-sending`),
  adminResetInvitations: (userId: number) =>
    post<{ revoked_sent: number; access_removed: number }>(`/api/admin/users/${userId}/reset-invitations`, {}),
  adminReenableEmail: (userId: number) =>
    post<{ enabled: boolean }>(`/api/admin/users/${userId}/reenable-email`, {}),

  // Operational status — no auth required, polled by App.tsx
  status: () => apiFetch<{ maintenance: boolean }>('/api/status'),

  // Maintenance + key rotation
  adminGetMaintenance: () => apiFetch<{ active: boolean }>('/api/admin/maintenance'),
  adminSetMaintenance: (active: boolean) =>
    post<{ active: boolean }>('/api/admin/maintenance', { active }),
  adminGetEpicMode: () => apiFetch<{ active: boolean }>('/api/admin/epic-mode'),
  adminSetEpicMode: (active: boolean) =>
    post<{ active: boolean }>('/api/admin/epic-mode', { active }),
  adminGetFlexiblePayoff: () => apiFetch<{ active: boolean }>('/api/admin/flexible-payoff'),
  adminSetFlexiblePayoff: (active: boolean) =>
    post<{ active: boolean }>('/api/admin/flexible-payoff', { active }),
  adminRotationStatus: () =>
    apiFetch<{ snapshot_exists: boolean; maintenance_active: boolean }>('/api/admin/rotation-status'),
  adminRotationRestore: () =>
    post<{ restored: number }>('/api/admin/rotation-restore', {}),

  // ── Sharing ──────────────────────────────────────────────────────────────

  // Inviter actions
  sendInvite: (email: string) => post<InvitationEntry>('/api/sharing/invite', { email }),
  getSentInvitations: () => apiFetch<InvitationEntry[]>('/api/sharing/sent'),
  resendInvitation: (id: number) => post<InvitationEntry>(`/api/sharing/invite/${id}/resend`, {}),
  revokeInvitation: (id: number) => apiFetch<void>(`/api/sharing/invite/${id}`, { method: 'DELETE' }),

  // Invitee actions
  acceptInvite: (data: { token?: string; code?: string }) => post<AcceptInviteResult>('/api/sharing/accept', data),
  getReceivedInvitations: () => apiFetch<ReceivedInvitation[]>('/api/sharing/received'),
  declineInvitation: (id: number) => apiFetch<void>(`/api/sharing/decline/${id}`, { method: 'POST' }),
  removeSharedAccess: (id: number) => apiFetch<void>(`/api/sharing/access/${id}`, { method: 'DELETE' }),
  setSharedNotify: (id: number, enabled: boolean) => put<{ enabled: boolean }>(`/api/sharing/access/${id}/notify`, { enabled }),

  // Public invite info (no auth)
  getInviteInfo: (params: { token?: string; code?: string }) => {
    const q = new URLSearchParams()
    if (params.token) q.set('token', params.token)
    if (params.code) q.set('code', params.code)
    return apiFetch<InviteInfoResult>(`/api/sharing/invite-info?${q}`)
  },

  // Shared data view (read-only, viewing another user's data)
  getSharedDashboard: (invId: number) => apiFetch<DashboardData>(`/api/sharing/view/${invId}/dashboard`),
  getSharedEvents: (invId: number) => apiFetch<TimelineEvent[]>(`/api/sharing/view/${invId}/events`),
  getSharedGrants: (invId: number) => apiFetch<GrantEntry[]>(`/api/sharing/view/${invId}/grants`),
  getSharedLoans: (invId: number) => apiFetch<LoanEntry[]>(`/api/sharing/view/${invId}/loans`),
  getSharedPrices: (invId: number) => apiFetch<PriceEntry[]>(`/api/sharing/view/${invId}/prices`),
  getSharedSales: (invId: number) => apiFetch<SaleEntry[]>(`/api/sharing/view/${invId}/sales`),
  getSharedTaxSettings: (invId: number) => apiFetch<TaxSettings>(`/api/sharing/view/${invId}/tax-settings`),
  getSharedSaleTax: (invId: number, saleId: number) => apiFetch<TaxBreakdown>(`/api/sharing/view/${invId}/sales/${saleId}/tax`),
  exportSharedExcel: (invId: number) => fetch(`/api/sharing/view/${invId}/export/excel`, { credentials: 'include' }),

  /** Stream SSE events from the key-rotation endpoint.
   *  Calls onEvent for each parsed event object.  Resolves when the stream ends.
   */
  adminRotateKey: async (onEvent: (e: RotationEvent) => void): Promise<void> => {
    const resp = await fetch('/api/admin/rotate-key', {
      method: 'POST',
      credentials: 'include',
    })
    if (!resp.ok || !resp.body) {
      throw new Error(`HTTP ${resp.status}`)
    }
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try { onEvent(JSON.parse(line.slice(6))) } catch { /* skip malformed */ }
        }
      }
    }
  },
}

export interface TipTypeReport {
  type: string
  unique_users: number
  total_savings: number
}

export interface TipsReport {
  unique_users_accepted: number
  total_estimated_savings: number
  by_type: TipTypeReport[]
}

export interface AdminStats {
  total_users: number
  active_users_30d: number
  total_grants: number
  total_loans: number
  total_prices: number
  db_size_bytes: number
  cpu_percent: number | null
  ram_used_mb: number | null
  ram_total_mb: number | null
}

export interface SystemMetricPoint {
  timestamp: string
  cpu_percent: number
  ram_used_mb: number
  ram_total_mb: number
  db_size_bytes: number
  error_log_count: number
  cache_l1_hits: number | null
  cache_l2_hits: number | null
  cache_misses: number | null
  cache_l2_key_count: number | null
}

export interface DbTableInfo {
  table_name: string
  size_bytes: number
  row_estimate: number
}

export interface AdminUser {
  id: number
  email: string
  name: string | null
  is_admin: boolean
  is_content_admin: boolean
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

export interface EmailLookupResult {
  email: string
  has_account: boolean
  user_id: number | null
  user_name: string | null
  is_admin: boolean
  email_notifications_enabled: boolean | null
  invitation_opt_out: boolean
  opt_out_id: number | null
  blocked_from_receiving: boolean
  blocked_id: number | null
  blocked_reason: string | null
  sending_blocked: boolean
  sending_block_id: number | null
  sending_block_reason: string | null
  invitations_sent: number
  invitations_received: number
}

export interface InvitationSummary {
  id: number
  invitee_email: string
  status: string
  created_at: string | null
  accepted_at: string | null
  invitee_name: string | null
}

export interface ReceivedInvitationSummary {
  id: number
  inviter_email: string
  inviter_name: string | null
  status: string
  accepted_at: string | null
}

export interface UserDetail {
  id: number
  email: string
  name: string | null
  is_admin: boolean
  created_at: string
  last_login: string | null
  grant_count: number
  loan_count: number
  price_count: number
  email_notifications_enabled: boolean | null
  push_subscriptions: number
  invitation_opt_out: boolean
  sending_blocked: boolean
  sending_block_reason: string | null
  invitations_sent: InvitationSummary[]
  invitations_received: ReceivedInvitationSummary[]
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

export interface SaleEntry {
  id: number
  version: number
  date: string
  shares: number
  price_per_share: number
  notes: string
  loan_id: number | null
  // Per-sale tax rate overrides (null = use user TaxSettings)
  federal_income_rate?: number | null
  federal_lt_cg_rate?: number | null
  federal_st_cg_rate?: number | null
  niit_rate?: number | null
  state_income_rate?: number | null
  state_lt_cg_rate?: number | null
  state_st_cg_rate?: number | null
  lt_holding_days?: number | null
  // Lot allocation + plan grouping + actual tax
  lot_overrides?: Array<{ vest_date: string; grant_year: number | null; grant_type: string | null; basis_price: number; shares: number }> | null
  sale_plan_id?: number | null
  actual_tax_paid?: number | null
}

export interface LoanPaymentEntry {
  id: number
  version: number
  loan_id: number
  date: string
  amount: number
  notes: string
}

export interface SaleEstimate {
  shares_needed: number
  gross_proceeds: number
  estimated_tax: number
  net_proceeds: number
  covers_loan: boolean | null
  loan_balance: number | null
}

export interface SaleLots {
  lots: { cost_basis: number; shares: number }[]
  total_shares: number
}

export interface LoanPayoffSuggestion {
  date: string
  shares: number
  price_per_share: number
  loan_id: number
  notes: string
  cash_due: number
}

export interface TaxSettings {
  federal_income_rate: number
  federal_lt_cg_rate: number
  federal_st_cg_rate: number
  niit_rate: number
  state_income_rate: number
  state_lt_cg_rate: number
  state_st_cg_rate: number
  lt_holding_days: number
  lot_selection_method: 'fifo' | 'lifo' | 'epic_lifo' | 'manual_tranche'
  loan_payoff_method: 'epic_lifo' | 'same_tranche' | 'lifo' | 'fifo'
  flexible_payoff_enabled: boolean
  prefer_stock_dp: boolean
  dp_min_percent: number
  dp_min_cap: number
  deduct_investment_interest: boolean
  deduction_excluded_years: number[] | null
  taxable_years: number[]
}

export interface TrancheLine {
  vest_date: string
  grant_year: number | null
  grant_type: string | null
  basis_price: number
  available_shares: number
  allocated_shares: number
  hold_start_date: string
  is_lt: boolean
}

export interface TrancheAllocation {
  lines: TrancheLine[]
  total_available: number
  total_allocated: number
}

export interface DeductionPreview {
  interest_deduction_total: number
  tax_savings_from_deduction: number
}

export interface ExitPreview extends ExitSummary {
  date: string
}

export interface LotSummary {
  grant_year: number | null
  grant_type: string | null
  shares: number
  lt_shares: number
  st_shares: number
}

// Wizard types
export interface WizardGrantTemplate {
  year: number | null
  type: string | null
  periods: number | null
  vest_start: string | null
  exercise_date: string | null
  price: number | null
}

export interface WizardPriceTemplate {
  effective_date: string
  price: number | null
}

export interface WizardParseResult {
  grants: WizardGrantTemplate[]
  prices: WizardPriceTemplate[]
}

export interface WizardLoan {
  loan_number: string
  loan_type: 'Purchase' | 'Tax' | 'Interest'
  loan_year: number
  amount: number
  interest_rate: number
  due_date: string
  refinances_loan_number: string
}

export interface WizardGrant {
  year: number
  type: string
  shares: number
  price: number
  vest_start: string
  periods: number
  exercise_date: string
  dp_shares: number
  election_83b: boolean
  loans: WizardLoan[]
}

export interface WizardSubmitPayload {
  grants: WizardGrant[]
  prices: { effective_date: string; price: number }[]
  clear_existing?: boolean
  generate_payoff_sales?: boolean
  preserve_grant_ids?: number[]
  preserve_price_ids?: number[]
}

export interface WizardSubmitResult {
  grants: number
  loans: number
  prices: number
  payoff_sales: number
}

export interface WizardPreviewGrant {
  year: number
  type: string
  status: 'added' | 'updated' | 'removed' | 'unchanged'
  id: number | null
  shares: number | null
  old_shares: number | null
  loans: number
  old_loans: number | null
}

export interface WizardPreviewPrice {
  effective_date: string
  status: 'added' | 'updated' | 'removed' | 'unchanged'
  id: number | null
  price: number | null
  old_price: number | null
}

export interface WizardPreviewResult {
  grants: WizardPreviewGrant[]
  prices: WizardPreviewPrice[]
}

export interface RotationEvent {
  step: 'snapshot' | 'maintenance' | 'rotating' | 'smoke' | 'persist' | 'done' | 'rollback' | 'error'
  msg: string
}

export interface TaxBreakdown {
  gross_proceeds: number
  cost_basis: number
  net_gain: number
  lt_shares: number
  lt_gain: number
  lt_rate: number
  lt_tax: number
  st_shares: number
  st_gain: number
  st_rate: number
  st_tax: number
  unvested_shares: number
  unvested_proceeds: number
  unvested_rate: number
  unvested_tax: number
  estimated_tax: number
  net_proceeds: number
  lots: LotSummary[]
}

// ── Sharing types ───────────────────────────────────────────────────────────

export interface InvitationEntry {
  id: number
  invitee_email: string
  status: 'pending' | 'accepted' | 'declined' | 'revoked'
  short_code: string
  created_at: string
  expires_at: string
  accepted_at: string | null
  last_viewed_at: string | null
  invitee_account_email: string | null
  invitee_name: string | null
  email_sent?: boolean
}

export interface AcceptInviteResult {
  message: string
  invitation_id: number
  inviter_name?: string
}

export interface ReceivedInvitation {
  id: number
  inviter_name: string | null
  inviter_email: string | null
  accepted_at: string | null
  last_viewed_at: string | null
  notify_enabled: boolean
}

export interface InviteInfoResult {
  valid: boolean
  inviter_name?: string
  status?: string
  reason?: string
}

export interface SharedAccount {
  invitation_id: number
  inviter_name: string
  inviter_email: string
}


// ── Grant program content (from GET /api/content) ──────────────────────────

export interface GrantTemplate {
  id: number
  year: number
  type: string
  vest_start: string
  periods: number
  exercise_date: string
  default_catch_up: boolean
  show_dp_shares: boolean
  default_purchase_due_month_day: string | null
  display_order: number
}

export interface GrantTypeDef {
  name: string
  color_class: string
  description: string
  is_pre_tax_when_zero_price: boolean
  display_order: number
}

export interface BonusScheduleVariant {
  id: number
  grant_year: number
  grant_type: string
  variant_code: string
  periods: number
  label: string
  is_default: boolean
}

export interface LoanRateRow {
  id: number
  loan_kind: 'interest' | 'tax' | 'purchase_original'
  grant_type: string | null
  year: number
  rate: number
  due_date: string | null
}

export interface LoanRefinanceRow {
  id: number
  chain_kind: 'purchase' | 'tax'
  grant_year: number
  grant_type: string | null
  orig_loan_year: number | null
  order_idx: number
  date: string
  rate: number
  loan_year: number
  due_date: string
  orig_due_date: string | null
}

export interface PurchaseOriginalLoan {
  rate: number
  due_date: string
}

export interface LoanRefinance {
  date: string
  rate: number
  loan_year: number
  due_date: string
}

export interface TaxLoanRefinance extends LoanRefinance {
  orig_due_date: string
}

export interface GrantProgramSettings {
  loan_term_years: number
  tax_fallback_federal: number
  tax_fallback_state: number
  flexible_payoff_enabled?: boolean
  // Derived (read-only) on the server from loan_rates / grant_templates.
  latest_rate_year: number
  price_years_start: number
  price_years_end: number
}

// Create/Update payloads for content-admin write endpoints
export interface GrantTemplateCreate {
  year: number
  type: string
  vest_start: string
  periods: number
  exercise_date: string
  default_catch_up?: boolean
  show_dp_shares?: boolean
  default_purchase_due_month_day?: string | null
  display_order?: number
  active?: boolean
  notes?: string | null
}

export interface LoanRateCreate {
  loan_kind: 'interest' | 'tax' | 'purchase_original'
  grant_type?: string | null
  year: number
  rate: number
  due_date?: string | null
}

export interface LoanRefinanceCreate {
  chain_kind: 'purchase' | 'tax'
  grant_year: number
  grant_type?: string | null
  orig_loan_year?: number | null
  order_idx: number
  date: string
  rate: number
  loan_year: number
  due_date: string
  orig_due_date?: string | null
}

export interface ContentBlob {
  grant_templates: GrantTemplate[]
  grant_type_defs: GrantTypeDef[]
  bonus_schedule_variants: BonusScheduleVariant[]
  loan_rates: {
    interest: Record<string, number>
    tax: Record<string, Record<string, number>>
    purchase_original: Record<string, PurchaseOriginalLoan>
  }
  loan_rates_all: LoanRateRow[]
  loan_refinances: {
    purchase: Record<string, LoanRefinance[]>
    tax: Record<string, TaxLoanRefinance[]>
  }
  loan_refinances_all: LoanRefinanceRow[]
  grant_program_settings: GrantProgramSettings
}

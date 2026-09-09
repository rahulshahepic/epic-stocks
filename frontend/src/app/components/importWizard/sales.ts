import type { WizardGrant, WizardSale } from '../../../api.ts'
import { saleIsComplete, type SaleDraft } from './types.ts'

export function remainingSaleShares(total: number | null | undefined, grants: WizardGrant[], keys: string[]) {
  if (total == null) return null
  const exchanged = grants.filter(g => keys.includes(`${g.year}:${g.type}`))
    .reduce((n, g) => n + Math.abs(g.dp_shares), 0)
  return total - exchanged
}

/** Only resize a wholly unanswered placeholder; never rewrite an entered transaction. */
export function resizeUnansweredSale(sales: SaleDraft[], available: number | null) {
  if (available == null || sales.length !== 1 || sales[0].date || sales[0].price_per_share) return sales
  return [{ ...sales[0], shares: Math.max(0, available) }]
}

export function saleReview(sales: SaleDraft[], existing: WizardSale[], available: number | null) {
  // Multiset matching preserves two real transactions with identical figures.
  const remaining = [...existing]
  const rows = sales.map(sale => {
    if (!saleIsComplete(sale)) return { sale, status: 'skipped' as const }
    const match = remaining.findIndex(s => s.date === sale.date && s.shares === sale.shares
      && s.price_per_share === Number(sale.price_per_share))
    if (match >= 0) {
      remaining.splice(match, 1)
      return { sale, status: 'existing' as const }
    }
    return { sale, status: 'new' as const }
  })
  const allocated = sales.reduce((n, s) => n + s.shares, 0)
  const completed = rows.filter(r => r.status !== 'skipped').reduce((n, r) => n + r.sale.shares, 0)
  const issues: string[] = []
  if (available != null && allocated > available) {
    issues.push('Sales and down-payment shares exceed the workbook total. Reduce the sale quantities or correct the exchanges on the grants screen.')
  }
  for (const [i, s] of sales.entries()) {
    if (!Number.isInteger(s.shares) || s.shares < 0 || s.shares > 10_000_000) {
      issues.push(`Sale ${i + 1}: enter a whole number of shares between 0 and 10,000,000.`)
    }
  }
  return {
    rows, issues,
    newCount: rows.filter(r => r.status === 'new').length,
    existingCount: rows.filter(r => r.status === 'existing').length,
    skippedCount: rows.filter(r => r.status === 'skipped').length,
    skippedShares: available == null ? Math.max(0, allocated - completed) : Math.max(0, available - completed),
  }
}

export type SaleReview = ReturnType<typeof saleReview>

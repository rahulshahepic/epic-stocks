/**
 * How far along a refinance chain the loan on record has actually got.
 *
 * Epic's documents never say when a loan was refinanced — the statement names a
 * loan "2018 Grant - Purchase Loan" however many times its terms have been
 * rewritten. What they do say is what the loan costs now, and a refinance is
 * exactly what changes that: the rate on the statement is the rate of the last
 * step the loan went through. So match it against the company-wide chain and
 * everything up to that step happened; a rate that matches no step means the
 * loan is still on its original terms.
 *
 * The chain itself (dates, rates, due dates) is admin-managed content — this
 * only decides how much of it to apply to one person's loan.
 */

/** One step of a chain, or the original terms, reduced to what can be matched. */
export interface RefiStepTerms {
  rate: number
  dueDate: string
}

export type RefiBasis =
  /** No rate to match against, so the whole chain is assumed. */
  | 'assumed'
  /** The rate on record identifies this step. */
  | 'rate'
  /** Several steps share that rate; the due date picked one. */
  | 'due-date'
  /** The rate on record is the original one — never refinanced. */
  | 'original'
  /** The rate matches nothing on record — treated as never refinanced. */
  | 'unmatched'

export interface RefiInference {
  /** How many steps of the chain to apply. 0 = still on the original terms. */
  steps: number
  basis: RefiBasis
}

// Epic prints rates to a hundredth of a percent, which is also how they are
// stored, so anything closer than that is the same rate.
const RATE_EPS = 5e-7

const sameRate = (a: number, b: number) => Math.abs(a - b) < RATE_EPS

export function inferRefiSteps(
  chain: RefiStepTerms[] | undefined,
  original: RefiStepTerms | undefined,
  observed: { rate?: number | null; dueDate?: string | null },
): RefiInference {
  if (!chain || chain.length === 0) return { steps: 0, basis: 'original' }

  const rate = observed.rate
  // Nothing on record to infer from — fall back to the company-wide chain.
  if (rate == null || !Number.isFinite(rate) || rate <= 0) {
    return { steps: chain.length, basis: 'assumed' }
  }

  const matches = chain
    .map((step, i) => ({ step, i }))
    .filter(({ step }) => sameRate(step.rate, rate))
  const matchesOriginal = original != null && sameRate(original.rate, rate)

  if (matches.length === 0) {
    return { steps: 0, basis: matchesOriginal ? 'original' : 'unmatched' }
  }
  if (matches.length === 1 && !matchesOriginal) {
    return { steps: matches[0].i + 1, basis: 'rate' }
  }

  // The rate alone cannot say which step — a refinance that only moved the due
  // date leaves the same rate on two steps, and a chain can also refinance at
  // the rate the loan started on. The due date is the remaining evidence.
  if (observed.dueDate) {
    const byDue = matches.filter(({ step }) => step.dueDate === observed.dueDate)
    if (byDue.length > 0) {
      return { steps: byDue[byDue.length - 1].i + 1, basis: 'due-date' }
    }
    if (matchesOriginal && original.dueDate && original.dueDate === observed.dueDate) {
      return { steps: 0, basis: 'original' }
    }
  }

  // Still ambiguous. A rate that matches a step means the loan was refinanced;
  // take the latest step it can be.
  return { steps: matches[matches.length - 1].i + 1, basis: 'rate' }
}

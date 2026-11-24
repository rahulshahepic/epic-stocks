const TERMS = {
  vesting: ['Vested and unvested shares', 'Vested shares are shares you have earned under the grant schedule. Unvested shares still depend on future vesting. Leaving can change what you keep; check your agreement.'],
  grant: ['Purchase and bonus grants', 'A purchase grant has a price you pay for the shares, often financed by a loan. A bonus or free grant starts without a purchase price; tax treatment depends on the agreement and any 83(b) election.'],
  basis: ['Cost basis', 'The amount used to calculate a taxable gain when shares are sold. It can include the purchase price or a value already treated as income; it is not the current share value.'],
  loan: ['Loan principal and interest', 'Principal is the amount still borrowed. Interest is the borrowing charge, which may accrue before it appears as another loan. Paying principal does not always settle every associated charge.'],
  tax: ['Estimated taxes', 'The app estimates taxes from your saved rates and records. Withholding, a tax loan and final tax owed can differ. Official records and your tax return determine the actual result.'],
  exit: ['Exit proceeds', 'Estimated cash left after the app applies the exit rules, loan obligations, interest and estimated taxes. Stock value alone is not the cash you would take home. Timing and settlement assumptions matter.'],
  price: ['Tentative share price', 'An estimate awaiting confirmation. Its effective date can make it applicable to a calculation without making it an officially announced price. Future growth assumptions are projections.'],
} as const

export type EquityTerm = keyof typeof TERMS

export default function EquityTerms({ terms, title = 'What do these terms mean?' }: {
  terms: EquityTerm[]; title?: string
}) {
  return (
    <details className="rounded-lg border border-cs-border bg-cs-surface p-3 text-xs text-cs-text-2">
      <summary className="cursor-pointer py-1 font-medium text-cs-brand">{title}</summary>
      <dl className="mt-3 space-y-3 leading-relaxed">
        {terms.map(key => <div key={key}><dt className="font-semibold text-cs-text">{TERMS[key][0]}</dt><dd className="mt-1">{TERMS[key][1]}</dd></div>)}
      </dl>
    </details>
  )
}

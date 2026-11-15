"""Presentation of the authoritative dated position; no browser accounting rules."""
from app.date_utils import to_date
from app.sales_engine import build_fifo_lots


def dashboard_details(payload, cutoff, *, grants=(), timeline=(), next_timeline=None, holdings_timeline=(),
                      holdings=(), live_loans=(), loans=(), payments=None, sales=(), sale_results=None,
                      projection=None):
    payments, sale_results = payments or {}, sale_results or {}
    events = [e for e in timeline if to_date(e['date']) <= cutoff]
    following = next((e for e in (timeline if next_timeline is None else next_timeline)
                      if to_date(e['date']) > cutoff), None)
    next_detail = ({k: (v.isoformat()[:10] if hasattr(v, 'isoformat') else v)
                    for k, v in following.items() if k != 'source'} if following else None)
    settled = {s.loan_id for s in sales if s.loan_id is not None and s.date <= cutoff}
    active = []
    for loan in live_loans:
        balance = round(max(0, loan.amount - payments.get(loan.id, 0)), 2)
        if loan.id not in settled and balance > 0:
            active.append(dict(id=loan.id, grantYear=loan.grant_year, grantType=loan.grant_type,
                               loanType=loan.loan_type, loanYear=loan.loan_year,
                               dueDate=loan.due_date.isoformat(), balance=balance,
                               interestRate=loan.interest_rate))
    held = {(h['grant_year'], h['grant_type']): h['vested_shares'] for h in holdings}
    price = payload.get('stock_valuation_price')
    grant_rows = []
    for g in grants:
        key = (g['year'], g['type'])
        purchased = to_date(g['exercise_date']) <= cutoff
        vested = sum(n for d, n in g['vesting'] if to_date(d) <= cutoff)
        unvested = max(0, g['shares'] - vested) if purchased else 0
        held_shares = held.get(key, 0)
        vested_value = round(held_shares * price, 2) if price is not None else None
        unvested_value = round(unvested * (g['price'] or 0), 2)
        grant_rows.append(dict(
            year=g['year'], type=g['type'], exerciseDate=to_date(g['exercise_date']).isoformat(),
            costBasis=g['price'] or 0, vestedShares=held_shares, unvestedShares=unvested,
            vestedValue=vested_value, unvestedValue=unvested_value,
            totalValue=round(vested_value + unvested_value, 2) if vested_value is not None else None,
            totalTax=round(sum(l.amount for l in live_loans
                               if (l.grant_year, l.grant_type) == key and l.loan_type == 'Tax'), 2),
            totalLoan=round(sum(l['balance'] for l in active if (l['grantYear'], l['grantType']) == key), 2),
        ))

    income_groups, vest_groups = {}, {}
    price_gains = 0
    for event in events:
        year, kind = event.get('grant_year'), event.get('grant_type')
        key = f'{year}|{kind}'
        if event.get('income', 0) > 0:
            row = income_groups.setdefault(key, dict(key=key, year=year, type=kind, income=0, events=0))
            row['income'] += event['income']
            row['events'] += 1
        if event.get('vesting_cap_gains'):
            row = vest_groups.setdefault(key, dict(key=key, year=year, type=kind, amount=0))
            row['amount'] += event['vesting_cap_gains']
        price_gains += event.get('price_cap_gains', 0) or 0

    cash_sales = []
    loan_by_id = {l.id: l for l in loans}
    # Repaid loans are still live (not refinanced); the shared sale-tax engine
    # has already selected their lots and applied any per-sale rate overrides.
    for sale in sorted(sales, key=lambda s: (s.date, s.id)):
        if sale.date > cutoff:
            continue
        loan = loan_by_id.get(sale.loan_id)
        payoff = max(0, loan.amount - payments.get(loan.id, 0)) if loan else 0
        proceeds = sale.shares * sale.price_per_share
        tax = sale_results.get(sale.id, {}).get('estimated_tax', 0)
        cash_sales.append(dict(id=sale.id, date=sale.date.isoformat(), shares=sale.shares,
                               price=sale.price_per_share, proceeds=round(proceeds, 2), tax=tax,
                               loanPayoff=round(payoff, 2), net=round(proceeds-tax-payoff, 2),
                               loanLabel=f'{loan.grant_year} {loan.grant_type} {loan.loan_type}' if loan else None))
    cash_totals = {key: round(sum(s[key] for s in cash_sales), 2)
                   for key in ('proceeds', 'tax', 'loanPayoff', 'net')}

    interest_rows = []
    if projection is not None:
        for loan in projection.loans:
            if loan.loan_type == 'Interest' and not loan.superseded:
                interest_rows.append(dict(id=loan.key, amount=loan.amount,
                    label=f'{loan.grant_year} {loan.grant_type} interest {loan.loan_year}',
                    note='Projected capitalised interest' if loan.projected else 'Booked interest'))
            accrued = projection.accrued_by_key.get(loan.key, 0)
            if accrued:
                interest_rows.append(dict(id=f'accrued:{loan.key}', amount=accrued,
                    label=f'{loan.grant_year} {loan.grant_type} accrued interest',
                    note='Actual/365 through this date or repayment'))
    total_interest = round(sum(r['amount'] for r in interest_rows), 2)
    total_cost_basis = round(sum(l[1] * l[2] for l in build_fifo_lots(holdings_timeline, cutoff))
                             + payload.get('purchased_unvested_stock_value', 0), 2)
    next_event = dict(date=next_detail['date'], event_type=next_detail['event_type']) if next_detail else None
    cards = {key: payload.get(key, 0) for key in (
        'current_price', 'total_income', 'total_cap_gains', 'total_tax_paid', 'cash_received',
        'interest_deduction_total', 'tax_savings_from_deduction', 'price_is_estimate',
        'total_stock_value', 'vested_stock_value', 'purchased_unvested_stock_value',
        'net_equity', 'accrued_unbooked_interest',
    )}
    cards['current_price'] = price
    cards['price_is_estimate'] = bool(payload.get('price_is_estimate', False))
    cards.update(total_shares=payload.get('held_vested_shares', 0),
                 total_loan_principal=payload.get('outstanding_loan_balance', 0),
                 total_interest=total_interest, total_cost_basis=total_cost_basis,
                 unvested_shares=sum(g['unvestedShares'] for g in grant_rows),
                 next_event=next_event, next_event_detail=next_detail)
    tax_loans = sum(l.amount for l in live_loans if l.loan_type == 'Tax')
    return dict(cards=cards, grant_holdings=grant_rows, active_loans=active,
        breakdowns=dict(
            cash=dict(sales=cash_sales, totals={**cash_totals, 'net': payload.get('cash_received', 0)}),
            income=dict(groups=list(income_groups.values()), total=payload['total_income']),
            capGains=dict(vestingGroups=list(vest_groups.values()),
                          vestingTotal=round(sum(r['amount'] for r in vest_groups.values()), 2),
                          priceTotal=round(price_gains, 2), total=payload['total_cap_gains']),
            interest=dict(rows=interest_rows, total=total_interest),
            tax=dict(taxLoans=round(tax_loans, 2), vestingIncomeTax=0,
                     cgTaxFromSales=round(sum(r['tax'] for r in cash_sales), 2),
                     deductionSavings=payload.get('tax_savings_from_deduction', 0),
                     total=payload.get('total_tax_paid', 0))))


def dashboard_chart_data(timeline, loans, settings, projection, today):
    """Financial series prepared once on the server; clients only filter/format."""
    from app.loan_state import loan_is_drawn, refinanced_loan_ids
    settings = settings or {}
    income_rate = settings.get('federal_income_rate', 0) + settings.get('state_income_rate', 0)
    cg_rate = (settings.get('federal_lt_cg_rate', 0) + settings.get('niit_rate', 0)
               + settings.get('state_lt_cg_rate', 0))
    tax = []
    sale_tax = deduction_saved = 0
    st_rate = (settings.get("federal_st_cg_rate", 0) + settings.get("niit_rate", 0)
               + settings.get("state_st_cg_rate", 0))
    for event in timeline:
        when = to_date(event['date'])
        replaced = refinanced_loan_ids(loans, when)
        recorded_tax = sum(l.amount for l in loans if l.loan_type == 'Tax'
                           and l.id not in replaced and loan_is_drawn(l, when))
        if event.get('event_type') == 'Sale':
            sale_tax += event.get('estimated_tax', 0) or 0
        deduction_saved += ((event.get('interest_deduction_on_stcg', 0) or 0) * st_rate
                            + (event.get('interest_deduction_on_ltcg', 0) or 0) * cg_rate)
        tax.append(dict(date=when.isoformat(),
            estimated=round(event.get('cum_income', 0) * income_rate
                            + event.get('cum_cap_gains', 0) * cg_rate, 2),
            paid=round(recorded_tax + sale_tax - deduction_saved, 2), projected=when > today))

    # The shared projection already capitalises and compounds interest and
    # stops it at repayment. Never reconstruct annual accrual from loan rates.
    yearly = {}
    for loan in projection.loans:
        if loan.loan_type != 'Interest' or loan.superseded:
            continue
        row = yearly.setdefault(loan.loan_year, [0.0, 0.0])
        row[int(loan.projected)] += loan.amount
    for payoff in projection.payoffs:
        yearly.setdefault(payoff.date.year, [0.0, 0.0])[1] += payoff.accrued + payoff.prepaid_interest
    recorded = projected = 0.0
    interest = []
    for year in sorted(yearly):
        recorded += yearly[year][0]
        projected += yearly[year][1]
        interest.append(dict(date=f'{year}-12-31', recorded=round(recorded, 2), projected=round(projected, 2)))
    return dict(tax=tax, interest=interest)

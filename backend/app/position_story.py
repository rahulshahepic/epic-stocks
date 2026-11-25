"""Plain language from service results, never a second financial calculator."""
from datetime import date
from app.date_utils import to_date


def position_story(payload, cutoff, *, active=(), events=(), exit_preview=None):
    money = lambda n: f"${n:,.0f}"
    shares = payload.get('held_vested_shares', 0)
    value = payload.get('vested_stock_value')
    price = payload.get('stock_valuation_price')
    sentences = []
    if payload.get('account_empty'):
        sentences.append('Add your stock files to see your position in plain words.')
    elif price is None:
        sentences.append(f'You hold {shares:,} vested shares. Add a share price to see their value and an exit estimate.')
    else:
        tentative = ' (estimated price)' if payload.get('price_is_estimate') else ''
        sentences.append(f'You hold {shares:,} vested shares, worth about {money(value)} at ${price:,.2f} per share{tentative}.')
    if active:
        first = min(active, key=lambda l: l['dueDate'])
        due = first['dueDate']
        debt = f"Your recorded outstanding principal is {money(payload['outstanding_loan_balance'])} across {len(active)} loans; accrued interest is separate."
        due_events = [e for e in events if to_date(e['date']).isoformat() == due and e.get('event_type') == 'Loan Payoff' and e.get('cash_due') is not None]
        sales = [e for e in events if to_date(e['date']).isoformat() == due and e.get('event_type') == 'Sale' and e.get('is_generated')]
        if due < cutoff.isoformat():
            debt += f' The earliest recorded due date, {due}, has passed; record the payoff if it was paid.'
        else:
            debt += f' The next recorded loan due date is {due}.'
            if due_events:
                debt += f" Modeled cash due then is {money(sum(e['cash_due'] for e in due_events))}."
            if sales:
                debt += f" The app plans to sell about {sum(abs(e.get('vested_shares') or 0) for e in sales):,} shares then; this is not a recorded sale."
        sentences.append(debt)
    elif not payload.get('account_empty'):
        sentences.append('No outstanding loans are recorded. If you have loans, import your latest statement before relying on this position.')
    if exit_preview is not None:
        cash = exit_preview['liquidation_net_cash']
        when = 'today' if cutoff == date.today() else f'on {cutoff.isoformat()}'
        if exit_preview.get('liquidation_shortfall', 0) > 0:
            sentences.append(f"Leaving {when} would require about {money(exit_preview['liquidation_shortfall'])} in additional cash to settle the exit. Earlier sale proceeds are separate.")
        else:
            sentences.append(f"If you left {when}, estimated cash from this exit after loans and tax is {money(cash)}. Earlier sale proceeds are separate.")
    questions = []
    if active:
        first = min(active, key=lambda l: l['dueDate'])
        questions.append(f"Use Epic Stocks: should I pay off my {first['grantYear']} loan early?")
    future = [e for e in events if to_date(e['date']) > cutoff]
    vest = next((e for e in future if e.get('event_type') == 'Vesting'), None)
    if vest:
        questions.append(f"Use Epic Stocks: what happens if I leave right after the {to_date(vest['date']).isoformat()} vest?")
    sale = next((e for e in future if e.get('event_type') == 'Sale' and e.get('is_generated')), None)
    if sale:
        questions.append(f"Use Epic Stocks: how much tax will my {to_date(sale['date']).year} repayment sale cost?")
    questions.append('Use Epic Stocks: help me choose a retirement date and compare it with one year later.')
    return {'summary_sentences': sentences, 'starter_questions': questions[:4]}

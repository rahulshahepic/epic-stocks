"""An annual view of the same dated accounting used by dashboard and MCP."""
from datetime import date

from scaffold.models import Grant, EmailPreference


def annual_summary(user, db, year):
    from app.routers.events import _get_dashboard_data
    start = _get_dashboard_data(user, db, date(year - 1, 12, 31), include_details=True, include_charts=False)['cards']
    end = _get_dashboard_data(user, db, date(year, 12, 31), include_details=True, include_charts=False)['cards']
    fields = [('Stock value', 'total_stock_value', 'dollars'),
              ('Vested holdings', 'total_shares', 'shares'),
              ('Outstanding loan principal', 'total_loan_principal', 'dollars'),
              ('Unbooked accrued interest', 'accrued_unbooked_interest', 'dollars'),
              ('Cumulative cash received', 'cash_received', 'dollars')]
    return {'year': year, 'price_is_estimate': bool(start.get('price_is_estimate') or end.get('price_is_estimate')),
            'note': 'Estimated changes reconstructed from your currently saved records, comparing the prior December 31 with this December 31. Re-imports and corrections can change historical figures. Net share changes include sales and exchanges as well as vesting; stock value is not exit cash. This is not an official statement.',
            'rows': [{'label': label, 'unit': unit, 'before': start.get(key), 'after': end.get(key),
                      'change': round(end[key] - start[key], 2) if start.get(key) is not None and end.get(key) is not None else None}
                     for label, key, unit in fields]}


def annual_summary_events(user, db, today):
    pref = db.query(EmailPreference).filter(EmailPreference.user_id == user.id).first()
    if not pref or not pref.annual_summary_enabled:
        return []
    year = today.year - 1
    if today.month != 1 or (user.annual_summary_year or 0) >= year:
        return []
    if not db.query(Grant).filter(Grant.user_id == user.id, Grant.year <= year).first():
        return []
    return [{'event_type': 'Annual Stock Summary', 'date': today, '_annual_summary_year': year,
             'reminder_message': 'Your annual stock summary is available on your dashboard. Sign in to review estimated changes; notification previews do not include amounts.'}]

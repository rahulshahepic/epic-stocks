"""Statement anchors are optional, dated, per-loan uncapitalized balances."""
from datetime import date

from app.loan_projection import project, outstanding_at_stop
from tests.test_loan_projection import _loan
from tests.conftest import register_user
from tests.test_mcp_tools import Mcp


def anchor(cutoff, amount, statement=None):
    return {"accrued_through": cutoff, "accrued_interest": amount,
            "statement_date": statement or cutoff}


def principal(id=1, amount=10000, checkpoints=()):
    row = _loan(id, 2025, "Purchase", "Purchase", 2025, amount, .0365,
                date(2028, 12, 31), date(2025, 1, 1))
    row['interest_checkpoints'] = list(checkpoints)
    return row


def value(rows, stop):
    p = project(rows, [], [], today=date(2026, 11, 15), stop=stop, withholding_rate=0)
    out = outstanding_at_stop(p)
    return round(out['accrued'] + out['projected_interest'], 2), p


def test_exact_at_cutoff_then_calculate_forward_and_preserve_earlier_dates():
    row = principal(checkpoints=[anchor(date(2025, 11, 1), 350)])
    assert value([row], date(2025, 11, 1))[0] == 350
    assert value([row], date(2025, 11, 15))[0] == 364
    assert value([row], date(2025, 10, 1))[0] == 273


def test_newer_monthly_statement_reanchors_only_from_its_cutoff():
    row = principal(checkpoints=[anchor(date(2025, 10, 1), 290), anchor(date(2025, 11, 1), 330)])
    assert value([row], date(2025, 10, 15))[0] == 304
    assert value([row], date(2025, 11, 15))[0] == 344


def test_missing_loan_continues_to_calculate():
    a = principal(checkpoints=[anchor(date(2025, 11, 1), 350)])
    b = principal(id=2)
    assert value([a, b], date(2025, 11, 15))[0] == 364 + 318


def test_zero_anchor_is_authoritative():
    row = principal(checkpoints=[anchor(date(2025, 11, 1), 0)])
    assert value([row], date(2025, 11, 1))[0] == 0
    assert value([row], date(2025, 11, 15))[0] == 14


def test_year_end_anchor_capitalizes_once():
    row = principal(checkpoints=[anchor(date(2025, 12, 31), 400)])
    total, p = value([row], date(2026, 1, 2))
    assert len(p.projected) == 1
    assert p.projected[0].amount == 401
    assert total == 402.04


def test_booked_interest_row_replaces_projected_anchor_interest():
    row = principal(checkpoints=[anchor(date(2025, 12, 31), 400)])
    booked = _loan(2, 2025, 'Purchase', 'Interest', 2025, 401, .0365,
                   date(2028, 12, 31))
    total, p = value([row, booked], date(2026, 1, 2))
    assert not p.projected
    assert total == 1.04


def test_first_partial_year_anchor_replaces_carried_stub():
    row = principal(checkpoints=[anchor(date(2026, 2, 1), 140)])
    row['disbursed_on'] = date(2025, 10, 1)
    assert value([row], date(2026, 2, 15))[0] == 154


def setup_account(client):
    register_user(client)
    client.post('/api/grants', json={"year": 2025, "type": "Purchase", "shares": 1000,
        "price": 10, "vest_start": "2026-09-30", "periods": 4, "exercise_date": "2025-01-01"})
    client.post('/api/prices', json={"effective_date": "2025-01-01", "price": 12})
    result = client.post('/api/loans?generate_payoff_sale=false', json={
        "grant_year": 2025, "grant_type": "Purchase", "loan_type": "Purchase", "loan_year": 2025,
        "amount": 10000, "interest_rate": .0365, "due_date": "2028-12-31", "loan_number": "TEST-A"})
    assert result.status_code == 201
    return result.json()


def checkpoint_body(loan):
    return {"loan_id": loan['id'], "statement_date": '2026-11-01',
            "accrued_through": '2026-11-01', "accrued_interest": 330, "source": "Monthly statement"}


def test_connector_preview_apply_readback(client):
    loan = setup_account(client)
    mcp = Mcp(client)
    changes = [{"kind": "interest_checkpoint", "action": "create", "values": checkpoint_body(loan)}]
    preview = mcp.call('apply_changes', changes=changes)
    assert client.get('/api/loan-interest-checkpoints').json() == []
    assert preview['position_after']['accrued_unbooked_interest'] != preview['position_before']['accrued_unbooked_interest']
    saved = mcp.call('apply_changes', changes=changes, confirm=preview['confirm'])
    assert saved['applied'] is True
    rows = client.get('/api/loan-interest-checkpoints').json()
    assert rows[0]['accrued_interest'] == 330
    assert mcp.call('list_interest_checkpoints')['checkpoints'][0]['id'] == rows[0]['id']


def test_validation_and_ownership(client, make_client):
    loan = setup_account(client)
    body = checkpoint_body(loan)
    for changes in ({'accrued_through': '2026-11-02'}, {'statement_date': '2099-01-01'},
                    {'accrued_interest': -1}, {'accrued_through': '2024-12-31'}):
        assert client.post('/api/loan-interest-checkpoints', json={**body, **changes}).status_code == 422
    with make_client('other@test.com') as other:
        assert other.post('/api/loan-interest-checkpoints', json=body).status_code == 404
    first = client.post('/api/loan-interest-checkpoints', json=body).json()
    assert client.post('/api/loan-interest-checkpoints', json=body).status_code == 422
    updated = client.put(f"/api/loan-interest-checkpoints/{first['id']}", json={
        'accrued_interest': 340, 'version': first['version']})
    assert updated.status_code == 200
    assert client.put(f"/api/loan-interest-checkpoints/{first['id']}", json={
        'accrued_interest': 350, 'version': first['version']}).status_code == 409


def test_zero_checkpoint_roundtrips_and_is_encrypted(client, db_session):
    from sqlalchemy import text
    loan = setup_account(client)
    result = client.post('/api/loan-interest-checkpoints', json={**checkpoint_body(loan), 'accrued_interest': 0})
    assert result.status_code == 201
    raw = db_session.execute(text('select accrued_interest, source from loan_interest_checkpoints')).one()
    assert raw[0].startswith('$ENC$') and raw[1].startswith('$ENC$')
    assert result.json()['accrued_interest'] == 0


def test_checkpoint_export_import_and_backup_restore(client):
    import io
    import openpyxl
    loan = setup_account(client)
    saved = client.post('/api/loan-interest-checkpoints', json=checkpoint_body(loan))
    assert saved.status_code == 201
    original = client.get('/api/export/excel').content
    wb = openpyxl.load_workbook(io.BytesIO(original))
    assert wb['InterestCheckpoints'].cell(2, 1).value == 2
    wb['InterestCheckpoints'].cell(2, 4).value = 440
    out = io.BytesIO()
    wb.save(out)
    imported = client.post('/api/import/excel', files={'file': ('roundtrip.xlsx', out.getvalue())})
    assert imported.status_code == 201, imported.text
    assert client.get('/api/loan-interest-checkpoints').json()[0]['accrued_interest'] == 440
    backup = client.get('/api/import/backups').json()[0]
    restored = client.post(f"/api/import/backups/{backup['id']}/restore")
    assert restored.status_code == 200, restored.text
    assert client.get('/api/loan-interest-checkpoints').json()[0]['accrued_interest'] == 330


def test_invalid_checkpoint_import_preserves_account(client):
    import io
    import openpyxl
    loan = setup_account(client)
    client.post('/api/loan-interest-checkpoints', json=checkpoint_body(loan))
    wb = openpyxl.load_workbook(io.BytesIO(client.get('/api/export/excel').content))
    wb['InterestCheckpoints'].cell(2, 1).value = 900
    out = io.BytesIO()
    wb.save(out)
    result = client.post('/api/import/excel', files={'file': ('bad.xlsx', out.getvalue())})
    assert result.status_code == 400
    assert client.get('/api/loan-interest-checkpoints').json()[0]['accrued_interest'] == 330


def test_partial_principal_payment_after_checkpoint():
    row = principal(checkpoints=[anchor(date(2025, 11, 1), 350)])
    p = project([row], [], [], today=date(2025, 11, 15), stop=date(2025, 11, 15), withholding_rate=0,
                loan_payments=[{'loan_id': 1, 'date': date(2025, 11, 7), 'amount': 5000}])
    assert outstanding_at_stop(p)['accrued'] == 360.5


def test_refinance_does_not_carry_old_checkpoint_twice():
    old = principal(checkpoints=[anchor(date(2025, 11, 1), 350)])
    successor = principal(id=2)
    successor.update(loan_year=2026, disbursed_on=date(2026, 1, 1), refinances_loan_id=1)
    total, p = value([old, successor], date(2026, 1, 2))
    assert sum(x.amount for x in p.projected) == 411
    assert total == 412.04


def test_refinance_boundary_checkpoint_cannot_capitalize_twice():
    old = principal(checkpoints=[anchor(date(2026, 1, 1), 365)])
    successor = principal(id=2)
    successor.update(loan_year=2026, disbursed_on=date(2026, 1, 1), refinances_loan_id=1)
    total, p = value([old, successor], date(2027, 1, 2))
    assert round(sum(x.amount for x in p.projected), 2) == 743.32
    assert total == value([{**old, 'interest_checkpoints': []}, successor], date(2027, 1, 2))[0]


def test_reject_checkpoint_before_inferred_purchase_start(client):
    loan = setup_account(client)
    grant = client.get('/api/grants').json()[0]
    changed = client.put(f"/api/grants/{grant['id']}", json={'exercise_date': '2025-09-30', 'version': grant['version']})
    assert changed.status_code == 200
    body = {**checkpoint_body(loan), 'statement_date': '2025-08-31', 'accrued_through': '2025-08-31'}
    assert client.post('/api/loan-interest-checkpoints', json=body).status_code == 422


def test_checkpoint_migration_is_reversible():
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect, text
    path = Path(__file__).parents[1] / 'alembic/versions/n5o6p7q8r9s0_interest_checkpoints.py'
    spec = importlib.util.spec_from_file_location('checkpoint_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE users (id INTEGER PRIMARY KEY)'))
        connection.execute(text('CREATE TABLE loans (id INTEGER PRIMARY KEY)'))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            assert 'loan_interest_checkpoints' in inspect(connection).get_table_names()
            assert 'statement_reminder_year' in {c['name'] for c in inspect(connection).get_columns('users')}
            migration.downgrade()
            assert 'loan_interest_checkpoints' not in inspect(connection).get_table_names()
            assert 'statement_reminder_year' not in {c['name'] for c in inspect(connection).get_columns('users')}
    engine.dispose()

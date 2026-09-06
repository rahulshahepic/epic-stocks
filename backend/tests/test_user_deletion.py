"""Deleting an account must actually delete the account.

DELETE /api/me listed the tables it cleared by hand and had drifted from the
admin path: it never removed sales, loan_payments or tax_settings. Those carry
a plain FK to users.id with no ON DELETE, so the closing DELETE FROM users hit
a foreign-key violation — account deletion was a 500 for anyone who had ever
recorded a sale, and the user's financial rows stayed on disk.

Both paths now go through scaffold.user_deletion. The completeness test below
walks the ORM metadata rather than a list written by hand, so a table added
later cannot quietly go unhandled.
"""
import sys
import os
from datetime import date

from sqlalchemy import text

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from database import Base
from scaffold.models import (
    User, Grant, Loan, LoanPayment, Price, Sale, TaxSettings,
    PushSubscription, EmailPreference, ImportBackup, TipAcceptance,
    InviteSendingBlock, Invitation, ErrorLog, UserReport,
)
from scaffold.user_deletion import USER_OWNED_TABLES, DELINKED_TABLES
from tests.conftest import register_user, user_key


def _seed_everything(client, db_session, email="full@example.com"):
    """A user carrying at least one row in every table that references them."""
    register_user(client, email)
    user = db_session.query(User).filter(User.email == email).first()

    client.post("/api/push/subscribe", json={
        "endpoint": "https://fcm.googleapis.com/fcm/send/abc",
        "keys": {"p256dh": "p256dh-test", "auth": "auth-test"},
    })

    with user_key(user):
        loan = Loan(
            user_id=user.id, grant_year=2020, grant_type="Purchase",
            loan_type="Full Recourse", loan_year=2020, amount=1000.0,
            interest_rate=0.05, due_date=date(2030, 1, 1), loan_number="L1",
        )
        db_session.add(loan)
        db_session.flush()
        db_session.add_all([
            Grant(user_id=user.id, year=2020, type="Purchase", shares=100, price=5.0,
                  vest_start=date(2021, 1, 1), periods=5,
                  exercise_date=date(2030, 1, 1), dp_shares=0),
            Price(user_id=user.id, effective_date=date(2020, 1, 1), price=5.0),
            Sale(user_id=user.id, date=date(2024, 5, 1), shares=10,
                 price_per_share=11.0, notes="", loan_id=loan.id),
            LoanPayment(user_id=user.id, loan_id=loan.id, date=date(2024, 6, 1),
                        amount=100.0, notes=""),
            TaxSettings(user_id=user.id),
            ImportBackup(user_id=user.id, data_json="{}"),
            TipAcceptance(user_id=user.id, tip_type="sale", savings_estimate=1.0),
            InviteSendingBlock(user_id=user.id, reason="test"),
            ErrorLog(user_id=user.id, path="/api/x", error_type="X", error_message="x"),
            UserReport(user_id=user.id, message="something broke", email=email,
                       user_agent="agent", client_log="log"),
        ])
        db_session.commit()
    return user


def _rows_referencing(db_session, user_id):
    """Every user-owned table that still holds a row for user_id."""
    left = {}
    for table, col in USER_OWNED_TABLES:
        n = db_session.execute(
            text(f"SELECT COUNT(*) FROM {table} WHERE {col} = :uid"), {"uid": user_id}
        ).scalar()
        if n:
            left[table] = n
    return left


# ── The contract ────────────────────────────────────────────────────────────

def test_every_user_owned_table_is_covered_by_the_deletion_service():
    """Walk the metadata: a table with a user_id column must be handled.

    Either it is deleted outright, or it is deliberately de-linked (diagnostic
    rows kept for triage). Anything else means a new table would survive an
    account deletion, which is what this test exists to prevent.
    """
    handled = {t for t, _ in USER_OWNED_TABLES} | {t for t, _ in DELINKED_TABLES}
    # invitations is handled explicitly: two FK columns, neither a plain delete.
    handled.add("invitations")
    handled.add("users")

    referencing = {
        table.name for table in Base.metadata.tables.values()
        if "user_id" in table.columns
    }

    assert referencing - handled == set(), (
        "these tables reference a user but scaffold.user_deletion does not "
        "handle them — add them to USER_OWNED_TABLES or DELINKED_TABLES"
    )


def test_deletion_order_is_foreign_key_safe():
    """USER_OWNED_TABLES is ordered children-first; sales must precede loans."""
    order = [t for t, _ in USER_OWNED_TABLES]
    assert order.index("sales") < order.index("loans")
    assert order.index("loan_payments") < order.index("loans")


# ── Self-serve deletion ─────────────────────────────────────────────────────

def test_delete_account_succeeds_for_a_user_with_a_sale(client, db_session):
    """The regression: a sale made DELETE /api/me a 500."""
    user_id = _seed_everything(client, db_session).id

    resp = client.delete("/api/me")

    assert resp.status_code == 204, resp.text
    db_session.expire_all()
    assert db_session.query(User).filter(User.id == user_id).count() == 0


def test_delete_account_leaves_no_user_owned_row_behind(client, db_session):
    user_id = _seed_everything(client, db_session).id

    assert client.delete("/api/me").status_code == 204

    db_session.expire_all()
    assert _rows_referencing(db_session, user_id) == {}


def test_delete_account_does_not_touch_another_user(client, make_client, db_session):
    victim_id = _seed_everything(client, db_session, "victim@example.com").id
    with make_client("other@example.com") as other:
        other.post("/api/prices", json={"effective_date": "2024-01-01", "price": 9.0})
        other_user = db_session.query(User).filter(User.email == "other@example.com").first()
        other_id = other_user.id

        assert client.delete("/api/me").status_code == 204

        assert db_session.query(User).filter(User.id == other_id).count() == 1
        assert db_session.query(Price).filter(Price.user_id == other_id).count() == 1
    assert db_session.query(User).filter(User.id == victim_id).count() == 0


def test_delete_account_keeps_reports_but_de_links_them(client, db_session):
    """A problem report someone wrote survives; nothing ties it to the account."""
    _seed_everything(client, db_session)

    assert client.delete("/api/me").status_code == 204

    db_session.expire_all()
    report = db_session.query(UserReport).first()
    assert report is not None
    assert report.message == "something broke"
    assert report.user_id is None
    assert report.email is None
    assert report.user_agent is None
    assert report.client_log is None
    assert db_session.query(ErrorLog).first().user_id is None


def test_delete_account_de_links_a_received_invitation(client, make_client, db_session):
    """The inviter keeps seeing the invitation; it no longer names the account."""
    register_user(client, "inviter@example.com")
    resp = client.post("/api/sharing/invite", json={"email": "invitee@example.com"})
    assert resp.status_code in (200, 201), resp.text

    inv = db_session.query(Invitation).first()
    invitee = _seed_everything(client, db_session, "invitee@example.com")
    inv.invitee_id = invitee.id
    inv.status = "accepted"
    db_session.commit()

    assert client.delete("/api/me").status_code == 204

    db_session.expire_all()
    inv = db_session.query(Invitation).first()
    assert inv is not None
    assert inv.invitee_id is None
    assert inv.status == "declined"


# ── Admin deletion ──────────────────────────────────────────────────────────

def test_admin_delete_user_leaves_no_user_owned_row_behind(client, make_client, db_session, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", "admin@example.com")
    target_id = _seed_everything(client, db_session, "target@example.com").id

    with make_client("admin@example.com") as admin:
        resp = admin.delete(f"/api/admin/users/{target_id}")
        assert resp.status_code == 204, resp.text

    db_session.expire_all()
    assert db_session.query(User).filter(User.id == target_id).count() == 0
    assert _rows_referencing(db_session, target_id) == {}


# ── Reset keeps the account ─────────────────────────────────────────────────

def test_reset_clears_financial_data_but_keeps_the_account(client, db_session):
    user = _seed_everything(client, db_session)

    assert client.post("/api/me/reset").status_code == 204

    assert db_session.query(User).filter(User.id == user.id).count() == 1
    for model in (Grant, Loan, LoanPayment, Price, Sale):
        assert db_session.query(model).filter(model.user_id == user.id).count() == 0
    # Not financial data — the account keeps these.
    assert db_session.query(PushSubscription).filter(
        PushSubscription.user_id == user.id).count() == 1
    assert db_session.query(EmailPreference).filter(
        EmailPreference.user_id == user.id).count() == 1

"""One place that knows how to erase a user.

Both deletion paths — DELETE /api/me (self-serve) and the admin endpoint —
call into here, because they had drifted: the self-serve path never deleted
sales, loan_payments or tax_settings, and since those tables carry a plain
FK to users.id with no ON DELETE, the final DELETE FROM users raised a
foreign-key violation. Account deletion was a 500 for any user who had ever
recorded a sale.

Raw SQL throughout, deliberately: the rows being removed hold encrypted
columns, and going through the ORM would decrypt every one of them on load
just to throw them away — which also means deletion would depend on the
right user key being in context.

USER_OWNED_TABLES is the contract. A test walks the SQLAlchemy metadata and
fails if a table with a user_id column is missing from it, so a table added
later cannot be silently left behind on deletion.

Deleting a real (non-synthetic) account also leaves a restore-time
tombstone outside the database — see services/tombstones.py — so a backup
restore cannot quietly resurrect the account (#819).
"""
from sqlalchemy import text

# (table, user_id column) in FK-safe order: children before parents.
USER_OWNED_TABLES: list[tuple[str, str]] = [
    ("reviewer_login_audit", "user_id"),
    ("reviewer_accounts", "user_id"),
    ("mcp_test_accounts", "user_id"),
    ("sensitive_reports", "user_id"),
    ("sales", "user_id"),
    ("loan_interest_checkpoints", "user_id"),
    ("loan_payments", "user_id"),
    ("loans", "user_id"),
    ("grant_vestings", "user_id"),
    ("grants", "user_id"),
    ("prices", "user_id"),
    ("push_subscriptions", "user_id"),
    ("email_preferences", "user_id"),
    ("tax_settings", "user_id"),
    ("import_backups", "user_id"),
    ("tip_acceptances", "user_id"),
    ("invite_sending_blocks", "user_id"),
    ("invite_send_events", "user_id"),
    # Connections to AI assistants, and half-finished authorizations. Deleting
    # the grant row is what makes an outstanding connector token stop working,
    # so this is the deletion that matters most here.
    ("oauth_grants", "user_id"),
    ("oauth_auth_codes", "user_id"),
    # The account's own record of what its assistants read. Deleted with the
    # account rather than de-linked: it is that person's activity, not a
    # diagnostic someone else needs to keep.
    ("mcp_audit", "user_id"),
]

# Financial data only — what POST /api/me/reset clears, keeping the account.
FINANCIAL_TABLES: list[tuple[str, str]] = [
    ("sales", "user_id"),
    ("loan_interest_checkpoints", "user_id"),
    ("loan_payments", "user_id"),
    ("loans", "user_id"),
    ("grant_vestings", "user_id"),
    ("grants", "user_id"),
    ("prices", "user_id"),
    ("import_backups", "user_id"),
]

# Diagnostic rows that reference a user but are not the user's data. They are
# kept for triage and de-linked instead of deleted; user_reports in particular
# must survive because someone took the trouble to write it.
DELINKED_TABLES: list[tuple[str, list[str]]] = [
    ("error_logs", ["user_id"]),
    ("user_reports", ["user_id", "email", "user_agent", "client_log"]),
]


def _clear_self_references(db, user_id: int) -> None:
    """Null the FKs rows hold on siblings that are about to disappear."""
    db.execute(
        text("UPDATE loans SET refinances_loan_id = NULL WHERE user_id = :uid"),
        {"uid": user_id},
    )
    db.execute(
        text("UPDATE sales SET loan_id = NULL WHERE user_id = :uid"),
        {"uid": user_id},
    )


def delete_financial_data(db, user_id: int) -> None:
    """Erase every financial row for user_id, leaving the account in place."""
    _clear_self_references(db, user_id)
    for table, col in FINANCIAL_TABLES:
        db.execute(text(f"DELETE FROM {table} WHERE {col} = :uid"), {"uid": user_id})


def _record_tombstone_on_commit(db, user_id, provider_name, subject, email, created_at) -> None:
    """Write the restore-time tombstone once this deletion commits (#819).

    A session event, because delete_user does not own the transaction: a
    deletion that rolls back must leave no tombstone behind. A stale firing
    is disarmed by re-checking that the account is actually gone, and a
    failed write is logged rather than failing a deletion that already
    committed.
    """
    import logging
    from sqlalchemy import event

    def _write(session):
        try:
            # The committing session cannot emit SQL in this state, and the
            # question — is the account actually gone? — is about the
            # database, so ask it on a fresh session.
            import database
            check = database.SessionLocal()
            try:
                gone = check.execute(
                    text("SELECT id FROM users WHERE id = :uid"), {"uid": user_id}).scalar() is None
            finally:
                check.close()
            if not gone:
                return
            from services.tombstones import record_deletion
            record_deletion(provider_name, subject, email, created_at)
        except Exception:
            logging.getLogger(__name__).exception(
                "Could not record the deletion tombstone for a deleted account")

    event.listen(db, "after_commit", _write, once=True)


def delete_user(db, user_id: int) -> None:
    from scaffold.synthetic_accounts import deletion_lock
    identity = db.execute(
        text("SELECT is_synthetic, provider_name, google_id, email, created_at FROM users WHERE id=:uid"),
        {"uid": user_id},
    ).first()
    synthetic = identity[0] if identity else None
    if identity and not identity[0]:
        _record_tombstone_on_commit(db, user_id, identity[1], identity[2], identity[3], identity[4])
    if synthetic:
        row = db.execute(text("SELECT user_id FROM mcp_test_accounts WHERE synthetic_id=:uid"), {"uid": user_id}).first()
        if row:
            with deletion_lock(db, row[0]):
                db.execute(text("DELETE FROM mcp_test_accounts WHERE synthetic_id=:uid"), {"uid": user_id})
                _delete_user(db, user_id)
        else:
            _delete_user(db, user_id)
    else:
        with deletion_lock(db, user_id):
            _delete_user(db, user_id)


def _delete_user(db, user_id: int) -> None:
    """Erase the account and everything belonging to it.

    Does not commit — the caller owns the transaction, so a failure part-way
    through rolls the whole deletion back rather than leaving a half-erased
    account.
    """
    from sqlalchemy import select
    from scaffold.models import User
    # Serialize with onboarding claims through transaction completion, before
    # scanning attempt bindings. No account identifier is added to those rows.
    db.execute(select(User.id).where(User.id == user_id).with_for_update()).first()
    from scaffold.synthetic_accounts import delete_test_accounts
    delete_test_accounts(db, user_id=user_id)
    from scaffold.onboarding import delete_account_linkage
    delete_account_linkage(db, user_id)
    _clear_self_references(db, user_id)

    db.execute(text(
        "DELETE FROM user_reports WHERE id IN (SELECT report_id FROM sensitive_reports WHERE user_id = :uid)"
    ), {"uid": user_id})

    for table, col in USER_OWNED_TABLES:
        db.execute(text(f"DELETE FROM {table} WHERE {col} = :uid"), {"uid": user_id})

    # Invitations this user received: keep the row so the inviter still sees
    # what became of it, but drop every link back to the deleted account.
    db.execute(
        text(
            "UPDATE invitations SET invitee_id = NULL, invitee_account_email = NULL,"
            " status = 'declined' WHERE invitee_id = :uid"
        ),
        {"uid": user_id},
    )
    # Invitations this user sent go with the account.
    db.execute(text("DELETE FROM invitations WHERE inviter_id = :uid"), {"uid": user_id})

    for table, cols in DELINKED_TABLES:
        assignments = ", ".join(f"{c} = NULL" for c in cols)
        db.execute(
            text(f"UPDATE {table} SET {assignments} WHERE user_id = :uid"),
            {"uid": user_id},
        )

    db.execute(text("DELETE FROM users WHERE id = :uid"), {"uid": user_id})

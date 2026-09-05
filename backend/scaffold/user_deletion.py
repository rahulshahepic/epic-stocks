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
"""
from sqlalchemy import text

# (table, user_id column) in FK-safe order: children before parents.
USER_OWNED_TABLES: list[tuple[str, str]] = [
    ("sales", "user_id"),
    ("loan_payments", "user_id"),
    ("loans", "user_id"),
    ("grants", "user_id"),
    ("prices", "user_id"),
    ("push_subscriptions", "user_id"),
    ("email_preferences", "user_id"),
    ("tax_settings", "user_id"),
    ("import_backups", "user_id"),
    ("tip_acceptances", "user_id"),
    ("invite_sending_blocks", "user_id"),
]

# Financial data only — what POST /api/me/reset clears, keeping the account.
FINANCIAL_TABLES: list[tuple[str, str]] = [
    ("sales", "user_id"),
    ("loan_payments", "user_id"),
    ("loans", "user_id"),
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


def delete_user(db, user_id: int) -> None:
    """Erase the account and everything belonging to it.

    Does not commit — the caller owns the transaction, so a failure part-way
    through rolls the whole deletion back rather than leaving a half-erased
    account.
    """
    _clear_self_references(db, user_id)

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

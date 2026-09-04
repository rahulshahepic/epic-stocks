"""seed the Developer Bonus Shares grant templates

Developer Bonus Shares are a zero-basis grant offered to people who started in
2020 and 2021: 5 vesting periods, 20% a year, both cohorts sharing a first vest
date of 2022-09-30. seed_content_if_empty() only fills an empty table, so an
already-seeded deployment needs the rows inserted here.

Idempotent and non-destructive: each row is skipped if a template already exists
for that (year, type), so a content admin who added one by hand keeps theirs.

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-09-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd0e1f2a3b4c5'
down_revision: Union[str, Sequence[str], None] = 'c9d0e1f2a3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TYPE = 'Developer Bonus Shares'
_ROWS = [
    # year, vest_start, periods, exercise_date
    (2020, '2022-09-30', 5, '2020-12-31'),
    (2021, '2022-09-30', 5, '2021-12-31'),
]


def upgrade() -> None:
    conn = op.get_bind()
    # Nothing to add on a fresh database — seed_content_if_empty() covers it.
    if conn.execute(sa.text("SELECT COUNT(*) FROM grant_templates")).scalar() == 0:
        return

    max_order = conn.execute(
        sa.text("SELECT COALESCE(MAX(display_order), 0) FROM grant_templates")
    ).scalar() or 0

    for offset, (year, vest_start, periods, exercise_date) in enumerate(_ROWS, start=1):
        exists = conn.execute(
            sa.text("SELECT 1 FROM grant_templates WHERE year = :y AND type = :t"),
            {"y": year, "t": _TYPE},
        ).first()
        if exists:
            continue
        conn.execute(
            sa.text("""
                INSERT INTO grant_templates
                    (year, type, vest_start, periods, exercise_date, default_catch_up,
                     show_dp_shares, default_purchase_due_date, default_tax_due_date,
                     display_order, active, notes)
                VALUES
                    (:year, :type, :vest_start, :periods, :exercise_date, :false_val,
                     :false_val, NULL, NULL, :display_order, :true_val, NULL)
            """),
            {
                "year": year, "type": _TYPE, "vest_start": vest_start,
                "periods": periods, "exercise_date": exercise_date,
                "display_order": max_order + offset,
                "false_val": False, "true_val": True,
            },
        )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text("DELETE FROM grant_templates WHERE type = :t"), {"t": _TYPE}
    )

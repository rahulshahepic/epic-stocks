"""add users.notify_push_intent

Whether the person wants push notifications where their devices allow it.

Intent only, never state. A push subscription can only be created by a device,
and only after that device grants permission, so a user-level flag can never
mean "push is on" — it decides whether to offer push on a device that has not
been asked yet. Backfilled to 1 for anyone who already has a subscription,
since enabling it somewhere is the clearest possible statement of intent.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-08-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8c9d0e1f2a3'
down_revision: Union[str, Sequence[str], None] = 'a7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('notify_push_intent', sa.Integer(), nullable=False, server_default='0'),
    )
    op.execute(
        "UPDATE users SET notify_push_intent = 1 "
        "WHERE id IN (SELECT DISTINCT user_id FROM push_subscriptions)"
    )


def downgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.drop_column('notify_push_intent')

"""add invite_send_events table

The daily invitation limit counted rows in `invitations`, which are deleted
when a revoked invitation to the same address is re-created. Deleting the row
deleted the record of the email already sent, so the limit could be spent over
and over. This table only ever gains rows.

Revision ID: c4d5e6f7g8h9
Revises: b3c4d5e6f7g8
Create Date: 2026-09-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4d5e6f7g8h9'
down_revision: Union[str, Sequence[str], None] = 'b3c4d5e6f7g8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'invite_send_events',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('sent_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_invite_send_events_user_id', 'invite_send_events', ['user_id'])
    op.create_index('ix_invite_send_events_sent_at', 'invite_send_events', ['sent_at'])


def downgrade() -> None:
    op.drop_index('ix_invite_send_events_sent_at', table_name='invite_send_events')
    op.drop_index('ix_invite_send_events_user_id', table_name='invite_send_events')
    op.drop_table('invite_send_events')

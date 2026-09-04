"""add trial_daily_stats table

Anonymous daily counters for the no-account preview funnel: how many previews
were computed, how many people pressed save, and how many accounts followed.
Three integers per day, keyed only by the date — no IP, no user agent, no
per-visitor row.

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-09-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, Sequence[str], None] = 'b8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'trial_daily_stats',
        sa.Column('day', sa.Date(), primary_key=True),
        sa.Column('previews', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('save_clicked', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('signups_from_trial', sa.Integer(), nullable=False, server_default='0'),
    )


def downgrade() -> None:
    op.drop_table('trial_daily_stats')

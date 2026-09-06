"""add import_proposals

An import an AI assistant prepared, waiting for the user to review it in the
wizard. The connector can prepare a draft but not apply one — epic_import/
requires that acceptance goes through the wizard and never a file, and that
holds however the draft was produced.

One row per account: a second proposal replaces the first.

Both blobs are encrypted. The payload is share counts and cost bases, and the
findings quote them back.

Revision ID: g8h9i0j1k2l4
Revises: f7g8h9i0j1k2
Create Date: 2026-09-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'g8h9i0j1k2l4'
down_revision: Union[str, Sequence[str], None] = 'f7g8h9i0j1k2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'import_proposals',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('client_name', sa.String(), nullable=False, server_default=''),
        sa.Column('payload_json', sa.String(), nullable=False),
        sa.Column('findings_json', sa.String(), nullable=False, server_default='[]'),
        sa.Column('blocked', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_import_proposals_user_id', 'import_proposals', ['user_id'], unique=True)
    op.create_index('ix_import_proposals_expires_at', 'import_proposals', ['expires_at'])


def downgrade() -> None:
    op.drop_table('import_proposals')

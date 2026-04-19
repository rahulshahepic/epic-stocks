"""seed wizard content

Creates six content tables that replace the hardcoded wizard constants in
frontend/src/app/components/ImportWizard.tsx and seeds them with the current
Epic values so wizard behavior is byte-for-byte unchanged.

Revision ID: q1r2s3t4u5v6
Revises: p0q1r2s3t4u5
Create Date: 2026-04-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'q1r2s3t4u5v6'
down_revision: Union[str, Sequence[str], None] = 'p0q1r2s3t4u5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'content_grant_templates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('type', sa.String(), nullable=False),
        sa.Column('vest_start', sa.String(), nullable=False),
        sa.Column('periods', sa.Integer(), nullable=False),
        sa.Column('exercise_date', sa.String(), nullable=False),
        sa.Column('default_catch_up', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('show_dp_shares', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('display_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('notes', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('year', 'type', name='uq_content_grant_template_year_type'),
    )

    op.create_table(
        'content_grant_type_defs',
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('color_class', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=False),
        sa.Column('is_pre_tax_when_zero_price', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('display_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('active', sa.Boolean(), nullable=False, server_default='1'),
        sa.PrimaryKeyConstraint('name'),
    )

    op.create_table(
        'content_bonus_schedule_variants',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('grant_year', sa.Integer(), nullable=False),
        sa.Column('grant_type', sa.String(), nullable=False),
        sa.Column('variant_code', sa.String(), nullable=False),
        sa.Column('periods', sa.Integer(), nullable=False),
        sa.Column('label', sa.String(), nullable=False, server_default=''),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default='0'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('grant_year', 'grant_type', 'variant_code', name='uq_content_bonus_variant'),
    )

    op.create_table(
        'content_loan_rates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('loan_kind', sa.String(), nullable=False),
        sa.Column('grant_type', sa.String(), nullable=True),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('rate', sa.Float(), nullable=False),
        sa.Column('due_date', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('loan_kind', 'grant_type', 'year', name='uq_content_loan_rate'),
    )

    op.create_table(
        'content_refi_chain_entries',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('chain_kind', sa.String(), nullable=False),
        sa.Column('grant_year', sa.Integer(), nullable=False),
        sa.Column('grant_type', sa.String(), nullable=True),
        sa.Column('orig_loan_year', sa.Integer(), nullable=True),
        sa.Column('order_idx', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('date', sa.String(), nullable=False),
        sa.Column('rate', sa.Float(), nullable=False),
        sa.Column('loan_year', sa.Integer(), nullable=False),
        sa.Column('due_date', sa.String(), nullable=False),
        sa.Column('orig_due_date', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'content_wizard_settings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('loan_term_years', sa.Integer(), nullable=False, server_default='10'),
        sa.Column('latest_rate_year', sa.Integer(), nullable=False, server_default='2025'),
        sa.Column('dp_shares_start_year', sa.Integer(), nullable=False, server_default='2023'),
        sa.Column('tax_fallback_federal', sa.Float(), nullable=False, server_default='0.37'),
        sa.Column('tax_fallback_state', sa.Float(), nullable=False, server_default='0.0765'),
        sa.Column('default_purchase_due_month_day_pre2022', sa.String(), nullable=False, server_default='07-15'),
        sa.Column('default_purchase_due_month_day_post2022', sa.String(), nullable=False, server_default='06-30'),
        sa.Column('price_years_start', sa.Integer(), nullable=False, server_default='2018'),
        sa.Column('price_years_end', sa.Integer(), nullable=False, server_default='2026'),
        sa.PrimaryKeyConstraint('id'),
    )

    # Seed rows live in app.content_service.SEED_* and are inserted on the next
    # lifespan boot via seed_content_if_empty().  Doing it there keeps SQLite test
    # environments (which use create_all and skip migrations) and PostgreSQL
    # deployments in sync — both pass through the same idempotent seeder.


    # (Seed data lives in app.content_service and runs on every boot.)


def downgrade() -> None:
    op.drop_table('content_wizard_settings')
    op.drop_table('content_refi_chain_entries')
    op.drop_table('content_loan_rates')
    op.drop_table('content_bonus_schedule_variants')
    op.drop_table('content_grant_type_defs')
    op.drop_table('content_grant_templates')

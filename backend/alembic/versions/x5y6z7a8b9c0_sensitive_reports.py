"""Store separately consented support data outside ordinary reports.

Revision ID: x5y6z7a8b9c0
Revises: w4x5y6z7a8b9
"""
from alembic import op
import sqlalchemy as sa

revision = "x5y6z7a8b9c0"
down_revision = "w4x5y6z7a8b9"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "sensitive_reports",
        sa.Column("report_id", sa.Integer, sa.ForeignKey("user_reports.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("expires_at", sa.DateTime, nullable=False),
        sa.Column("document_bytes", sa.Integer, nullable=False),
        sa.Column("wrapped_key", sa.Text, nullable=False),
        sa.Column("details", sa.LargeBinary, nullable=False),
    )
    op.create_index("ix_sensitive_reports_user_id", "sensitive_reports", ["user_id"])
    op.create_index("ix_sensitive_reports_expires_at", "sensitive_reports", ["expires_at"])
    op.create_table(
        "sensitive_report_documents",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("report_id", sa.Integer, sa.ForeignKey("sensitive_reports.report_id", ondelete="CASCADE"), nullable=False),
        sa.Column("metadata_ciphertext", sa.LargeBinary, nullable=False),
        sa.Column("original", sa.LargeBinary, nullable=False),
    )
    op.create_index("ix_sensitive_report_documents_report_id", "sensitive_report_documents", ["report_id"])


def downgrade():
    op.drop_table("sensitive_report_documents")
    op.drop_table("sensitive_reports")

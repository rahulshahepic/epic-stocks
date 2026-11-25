"""Store the accounting method used by investment interest estimates."""
from alembic import op
import sqlalchemy as sa

revision = "w4x5y6z7a8b9"
down_revision = "v3w4x5y6z7a8"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tax_settings", sa.Column(
        "investment_interest_method", sa.String(), server_default="accrual", nullable=False,
    ))


def downgrade():
    op.drop_column("tax_settings", "investment_interest_method")

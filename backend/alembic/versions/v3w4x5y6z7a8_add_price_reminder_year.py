"""Remember successfully delivered annual price reminders."""
from alembic import op
import sqlalchemy as sa

revision = 'v3w4x5y6z7a8'
down_revision = 'u2v3w4x5y6z7'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('price_reminder_year', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('users', 'price_reminder_year')

"""add last_visited_path to user_preferences

Revision ID: 0002_add_last_visited_path
Revises: 0001_initial_schema
Create Date: 2026-05-07

"""
from alembic import op
import sqlalchemy as sa

revision = '0002_add_last_visited_path'
down_revision = '0001_initial_schema'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'user_preferences',
        sa.Column('last_visited_path', sa.String(500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('user_preferences', 'last_visited_path')

"""initial schema

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-05-04

"""
from alembic import op
import sqlalchemy as sa

revision = '0001_initial_schema'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('password_hash', sa.String(255), nullable=False),
        sa.Column('full_name', sa.String(255), nullable=True),
        sa.Column('role', sa.String(32), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email'),
    )

    op.create_table(
        'user_preferences',
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('tts_enabled', sa.Boolean(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )

    op.create_table(
        'user_onboarding',
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('phase', sa.Integer(), nullable=False),
        sa.Column('child_name', sa.String(100), nullable=True),
        sa.Column('child_age', sa.String(20), nullable=True),
        sa.Column('child_school', sa.String(200), nullable=True),
        sa.Column('child_strengths', sa.JSON(), nullable=True),
        sa.Column('child_hobbies', sa.JSON(), nullable=True),
        sa.Column('child_thinking_pattern', sa.String(100), nullable=True),
        sa.Column('child_communication_style', sa.String(100), nullable=True),
        sa.Column('child_energy_level', sa.String(100), nullable=True),
        sa.Column('child_social_behaviour', sa.String(100), nullable=True),
        sa.Column('child_emotional_behaviour', sa.String(100), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )

    op.create_table(
        'user_personality',
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('source', sa.String(20), nullable=True),
        sa.Column('personality_type', sa.String(100), nullable=True),
        sa.Column('profile_name', sa.String(100), nullable=True),
        sa.Column('category', sa.String(50), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('color', sa.String(100), nullable=True),
        sa.Column('scores', sa.JSON(), nullable=False),
        sa.Column('traits', sa.JSON(), nullable=False),
        sa.Column('strengths', sa.JSON(), nullable=False),
        sa.Column('growth_areas', sa.JSON(), nullable=False),
        sa.Column('famous_people', sa.JSON(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )

    op.create_table(
        'user_journey',
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('overview', sa.Text(), nullable=True),
        sa.Column('focus_areas', sa.JSON(), nullable=False),
        sa.Column('initial_missions', sa.JSON(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )

    op.create_table(
        'user_goals',
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('parent_concern', sa.Text(), nullable=True),
        sa.Column('goals_plan', sa.JSON(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )

    op.create_table(
        'user_recommendations_progress',
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('progress', sa.JSON(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )

    op.create_table(
        'completed_growth_areas',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('area_id', sa.String(50), nullable=False),
        sa.Column('area_name', sa.String(100), nullable=False),
        sa.Column('area_color', sa.String(100), nullable=False),
        sa.Column('answers', sa.JSON(), nullable=False),
        sa.Column('recommendations', sa.JSON(), nullable=True),
        sa.Column('child_selections', sa.JSON(), nullable=False),
        sa.Column('child_summary', sa.Text(), nullable=True),
        sa.Column('child_strengths', sa.JSON(), nullable=False),
        sa.Column('child_suggested', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'area_id', name='uq_user_area'),
    )
    op.create_index('ix_growth_areas_user_created', 'completed_growth_areas', ['user_id', 'created_at'])

    op.create_table(
        'children',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_children_user_created', 'children', ['user_id', 'created_at'])

    op.create_table(
        'growth_missions',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('child_id', sa.String(36), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['child_id'], ['children.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_missions_child_created', 'growth_missions', ['child_id', 'created_at'])

    op.create_table(
        'parent_insights',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('child_id', sa.String(36), nullable=False),
        sa.Column('is_read', sa.Boolean(), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['child_id'], ['children.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_insights_child_read_created', 'parent_insights', ['child_id', 'is_read', 'created_at'])

    op.create_table(
        'reflections',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('child_id', sa.String(36), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['child_id'], ['children.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_reflections_child_created', 'reflections', ['child_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_reflections_child_created', table_name='reflections')
    op.drop_table('reflections')
    op.drop_index('ix_insights_child_read_created', table_name='parent_insights')
    op.drop_table('parent_insights')
    op.drop_index('ix_missions_child_created', table_name='growth_missions')
    op.drop_table('growth_missions')
    op.drop_index('ix_children_user_created', table_name='children')
    op.drop_table('children')
    op.drop_index('ix_growth_areas_user_created', table_name='completed_growth_areas')
    op.drop_table('completed_growth_areas')
    op.drop_table('user_recommendations_progress')
    op.drop_table('user_goals')
    op.drop_table('user_journey')
    op.drop_table('user_personality')
    op.drop_table('user_onboarding')
    op.drop_table('user_preferences')
    op.drop_table('users')

"""initial schema

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-05-08

Complete schema for a fresh database — all tables in their final form.
No data migrations or ALTER TABLE steps; this is the authoritative
starting point for every new deployment.

Multi-region usage
------------------
Run against the regional / single-instance DB (default):
    alembic upgrade head

Run against the dedicated Global Router DB only:
    alembic -x db=router upgrade head

When db=router, only the user_regions table is created.
When db=regional (default), ALL tables are created (including user_regions,
which is harmless but unused on a regional DB in multi-region mode).
"""
from alembic import op, context as _ctx
import sqlalchemy as sa

revision = '0001_initial_schema'
down_revision = None
branch_labels = None
depends_on = None


def _db_target() -> str:
    """Return 'router' when invoked with -x db=router, else 'regional'."""
    try:
        return _ctx.get_x_argument(as_dictionary=True).get("db", "regional")
    except Exception:
        return "regional"


def upgrade() -> None:
    # ------------------------------------------------------------------
    # user_regions — PII-free routing index (email_hash → region).
    # No FK to users: this table can live in a dedicated Router DB
    # (ROUTER_DB_URL) or alongside the rest in single-instance mode.
    #
    # Created on BOTH router DB and regional/single-instance DB so that
    # single-instance mode works without a separate ROUTER_DB_URL.
    # In multi-region mode the copy on each regional DB is never written
    # to — the authoritative routing table lives exclusively on ROUTER_DB_URL.
    # Querying user_regions on a regional DB in multi-region mode will return
    # empty results; always use get_router_db() for routing lookups.
    # ------------------------------------------------------------------
    op.create_table(
        'user_regions',
        sa.Column('email_hash', sa.String(64), nullable=False),
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('region', sa.String(16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('is_deleted', sa.Boolean(), nullable=False,
                  server_default=sa.false()),
        # Saga status: 'pending' after Phase 1 write; 'active' after Phase 2 confirmed.
        sa.Column('status', sa.String(16), nullable=False,
                  server_default='active'),
        sa.PrimaryKeyConstraint('email_hash'),
        # Unique constraint on user_id — one routing record per user.
        # The constraint itself creates the index; no separate CREATE INDEX needed.
        sa.UniqueConstraint('user_id', name='uq_user_regions_user_id'),
    )
    op.create_index('ix_user_regions_status_created_at', 'user_regions', ['status', 'created_at'])

    if _db_target() == "router":
        # Router DB only needs the routing index — stop here.
        return

    # ------------------------------------------------------------------
    # All remaining tables belong on the regional / single-instance DB.
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # users
    # ------------------------------------------------------------------
    op.create_table(
        'users',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('password_hash', sa.String(255), nullable=False),
        sa.Column('full_name', sa.String(255), nullable=False),
        sa.Column('role', sa.String(32), nullable=False),
        sa.Column('country_code', sa.String(4), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('tokens_revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email'),
    )

    # ------------------------------------------------------------------
    # refresh_tokens
    # ------------------------------------------------------------------
    op.create_table(
        'refresh_tokens',
        sa.Column('jti', sa.String(36), nullable=False),
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('jti'),
    )
    op.create_index('ix_refresh_tokens_user_id', 'refresh_tokens', ['user_id'])
    # Allows cleanup_expired_tokens() to delete by expiry without a full table scan.
    op.create_index('ix_refresh_tokens_expires_at', 'refresh_tokens', ['expires_at'])

    # ------------------------------------------------------------------
    # user_preferences
    # ------------------------------------------------------------------
    op.create_table(
        'user_preferences',
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('tts_enabled', sa.Boolean(), nullable=False,
                  server_default=sa.true()),
        sa.Column('last_visited_path', sa.String(500), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )

    # ------------------------------------------------------------------
    # user_onboarding
    # ------------------------------------------------------------------
    op.create_table(
        'user_onboarding',
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('phase', sa.Integer(), nullable=False, server_default='0'),
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
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )

    # ------------------------------------------------------------------
    # user_personality
    # server_default on JSON NOT NULL columns guards against raw-SQL inserts
    # that omit those fields (ORM always sets Python-side defaults).
    # ------------------------------------------------------------------
    op.create_table(
        'user_personality',
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('source', sa.String(20), nullable=True),
        sa.Column('personality_type', sa.String(100), nullable=True),
        sa.Column('profile_name', sa.String(100), nullable=True),
        sa.Column('category', sa.String(50), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('color', sa.String(100), nullable=True),
        sa.Column('scores', sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column('traits', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column('strengths', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column('growth_areas', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column('famous_people', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )

    # ------------------------------------------------------------------
    # user_journey
    # ------------------------------------------------------------------
    op.create_table(
        'user_journey',
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('overview', sa.Text(), nullable=True),
        sa.Column('focus_areas', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column('initial_missions', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )

    # ------------------------------------------------------------------
    # user_goals
    # ------------------------------------------------------------------
    op.create_table(
        'user_goals',
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('parent_concern', sa.Text(), nullable=True),
        sa.Column('goals_plan', sa.JSON(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )

    # ------------------------------------------------------------------
    # user_recommendations_progress
    # `step` and `current_area_index` are promoted real columns for
    # analytics queries; full wizard state lives in `progress` JSON.
    # ------------------------------------------------------------------
    op.create_table(
        'user_recommendations_progress',
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('step', sa.String(50), nullable=False,
                  server_default='intro'),
        sa.Column('current_area_index', sa.Integer(), nullable=False,
                  server_default='0'),
        sa.Column('progress', sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )
    op.create_index('ix_recommendations_progress_step',
                    'user_recommendations_progress', ['step'])

    # ------------------------------------------------------------------
    # completed_growth_areas
    # ------------------------------------------------------------------
    op.create_table(
        'completed_growth_areas',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('area_id', sa.String(50), nullable=False),
        sa.Column('area_name', sa.String(100), nullable=False),
        sa.Column('area_color', sa.String(100), nullable=False),
        sa.Column('answers', sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column('recommendations', sa.JSON(), nullable=True),
        sa.Column('child_selections', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column('child_summary', sa.Text(), nullable=True),
        sa.Column('child_strengths', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column('child_suggested', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'area_id', name='uq_user_area'),
    )
    op.create_index('ix_growth_areas_user_created', 'completed_growth_areas',
                    ['user_id', 'created_at'])

    # ------------------------------------------------------------------
    # children
    # `name`, `age`, `school` are real columns (promoted from old JSON
    # payload) so child lists can be sorted/filtered at the DB level.
    # ------------------------------------------------------------------
    op.create_table(
        'children',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('name', sa.String(255), nullable=False, server_default=''),
        sa.Column('age', sa.String(20), nullable=True),
        sa.Column('school', sa.String(300), nullable=True),
        sa.Column('payload', sa.JSON(), nullable=True, server_default=sa.text("'{}'")),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_children_user_created', 'children',
                    ['user_id', 'created_at'])
    op.create_index('ix_children_user_name', 'children', ['user_id', 'name'])

    # ------------------------------------------------------------------
    # growth_missions
    # `title`, `status`, `pillar` promoted from JSON payload so mission
    # lists can be filtered by status/pillar without parsing every row.
    # ------------------------------------------------------------------
    op.create_table(
        'growth_missions',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('child_id', sa.String(36), nullable=False),
        sa.Column('title', sa.String(255), nullable=False, server_default=''),
        sa.Column('status', sa.String(50), nullable=False,
                  server_default='active'),
        sa.Column('pillar', sa.String(100), nullable=True),
        sa.Column('payload', sa.JSON(), nullable=True, server_default=sa.text("'{}'")),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['child_id'], ['children.id'],
                                ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_missions_child_created', 'growth_missions',
                    ['child_id', 'created_at'])
    op.create_index('ix_missions_child_status', 'growth_missions',
                    ['child_id', 'status'])

    # ------------------------------------------------------------------
    # updated_at auto-update triggers (PostgreSQL only)
    # SQLAlchemy's onupdate=func.now() is ORM-only; raw SQL updates
    # (migrations, admin tools) would leave updated_at stale without these.
    # SQLite has no CREATE OR REPLACE FUNCTION — skip silently.
    # ------------------------------------------------------------------
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql' and _db_target() != 'router':
        op.execute("""
            CREATE OR REPLACE FUNCTION _set_updated_at()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        """)
        _tables_with_updated_at = [
            'users',
            'user_preferences',
            'user_onboarding',
            'user_personality',
            'user_journey',
            'user_goals',
            'user_recommendations_progress',
            'completed_growth_areas',
            'children',
            'growth_missions',
        ]
        for _tbl in _tables_with_updated_at:
            op.execute(f"""
                CREATE TRIGGER trg_{_tbl}_updated_at
                BEFORE UPDATE ON {_tbl}
                FOR EACH ROW EXECUTE FUNCTION _set_updated_at();
            """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql' and _db_target() != 'router':
        # Drop triggers before their tables (cleaner; tables would cascade-drop
        # triggers anyway, but the function must be dropped separately).
        for _tbl in [
            'growth_missions', 'children', 'completed_growth_areas',
            'user_recommendations_progress', 'user_goals', 'user_journey',
            'user_personality', 'user_onboarding', 'user_preferences', 'users',
        ]:
            op.execute(f"DROP TRIGGER IF EXISTS trg_{_tbl}_updated_at ON {_tbl};")
        op.execute("DROP FUNCTION IF EXISTS _set_updated_at();")

    if _db_target() != "router":
        op.drop_index('ix_missions_child_status', table_name='growth_missions')
        op.drop_index('ix_missions_child_created', table_name='growth_missions')
        op.drop_table('growth_missions')
        op.drop_index('ix_children_user_name', table_name='children')
        op.drop_index('ix_children_user_created', table_name='children')
        op.drop_table('children')
        op.drop_index('ix_growth_areas_user_created',
                      table_name='completed_growth_areas')
        op.drop_table('completed_growth_areas')
        op.drop_index('ix_recommendations_progress_step',
                      table_name='user_recommendations_progress')
        op.drop_table('user_recommendations_progress')
        op.drop_table('user_goals')
        op.drop_table('user_journey')
        op.drop_table('user_personality')
        op.drop_table('user_onboarding')
        op.drop_table('user_preferences')
        op.drop_index('ix_refresh_tokens_expires_at', table_name='refresh_tokens')
        op.drop_index('ix_refresh_tokens_user_id', table_name='refresh_tokens')
        op.drop_table('refresh_tokens')
        op.drop_table('users')

    op.drop_index('ix_user_regions_status_created_at', table_name='user_regions')
    op.drop_table('user_regions')

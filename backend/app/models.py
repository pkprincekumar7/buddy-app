from datetime import datetime, timezone
import uuid

from sqlalchemy import Boolean, false, ForeignKey, Index, Integer, String, Text, DateTime, JSON, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


# ---------------------------------------------------------------------------
# Global Router table
# ---------------------------------------------------------------------------

class UserRegionRecord(Base):
    """
    Lightweight routing index: email_hash → region.

    In single-instance mode this table lives in the main DB alongside all
    other tables.  When ROUTER_DB_URL is set it migrates to the dedicated
    Global Router DB (run alembic_router migrations on that instance).

    Stores sha256(email.lower()) — never the raw email — so no PII is held
    here and no data-residency law applies to this table.
    """
    __tablename__ = "user_regions"

    email_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)
    region: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    # Tombstone flag used during account deletion to close the re-registration
    # race window.  True only for the brief period between the user row being
    # queued for deletion and the router record being hard-deleted.
    # Any row with is_deleted=True whose user row no longer exists is safe to
    # remove: DELETE FROM user_regions WHERE is_deleted = TRUE;
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    # Saga status: 'pending' after Phase 1 (router write), 'active' after Phase 3
    # (confirmed regional write).  The background reconciler repairs stale 'pending'
    # rows — activating them when the user row exists, deleting them when it does not.
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="active", server_default="active"
    )


# ---------------------------------------------------------------------------
# Core user models
# ---------------------------------------------------------------------------

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False, default="Parent")
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="parent")
    # ISO-3166-1 alpha-2 country code supplied at registration (e.g. "IN", "DE").
    country_code: Mapped[str | None] = mapped_column(String(4), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=func.now(), onupdate=func.now())
    # Set to UTC now at the start of account deletion to immediately invalidate
    # all outstanding access tokens.  get_current_user rejects any token whose
    # iat <= tokens_revoked_at.
    tokens_revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    jti: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)


# ---------------------------------------------------------------------------
# User preference & onboarding models (JSON kept — always read as whole unit)
# ---------------------------------------------------------------------------

class UserPreferencesRecord(Base):
    __tablename__ = "user_preferences"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    tts_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_visited_path: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=func.now(), onupdate=func.now())


class UserOnboardingRecord(Base):
    __tablename__ = "user_onboarding"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    phase: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    child_name: Mapped[str | None] = mapped_column(String(100))
    child_age: Mapped[str | None] = mapped_column(String(20))
    child_school: Mapped[str | None] = mapped_column(String(200))
    child_strengths: Mapped[list | None] = mapped_column(JSON)
    child_hobbies: Mapped[list | None] = mapped_column(JSON)
    child_thinking_pattern: Mapped[str | None] = mapped_column(String(100))
    child_communication_style: Mapped[str | None] = mapped_column(String(100))
    child_energy_level: Mapped[str | None] = mapped_column(String(100))
    child_social_behaviour: Mapped[str | None] = mapped_column(String(100))
    child_emotional_behaviour: Mapped[str | None] = mapped_column(String(100))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=func.now(), onupdate=func.now())


class UserPersonalityRecord(Base):
    __tablename__ = "user_personality"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    source: Mapped[str | None] = mapped_column(String(20))
    personality_type: Mapped[str | None] = mapped_column(String(100))
    profile_name: Mapped[str | None] = mapped_column(String(100))
    category: Mapped[str | None] = mapped_column(String(50))
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(100))
    scores: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})
    traits: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
    strengths: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
    growth_areas: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
    famous_people: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=func.now(), onupdate=func.now())


class UserJourneyRecord(Base):
    __tablename__ = "user_journey"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    overview: Mapped[str | None] = mapped_column(Text)
    focus_areas: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
    initial_missions: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=func.now(), onupdate=func.now())


class UserGoalsRecord(Base):
    __tablename__ = "user_goals"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    parent_concern: Mapped[str | None] = mapped_column(Text)
    goals_plan: Mapped[dict | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=func.now(), onupdate=func.now())


# ---------------------------------------------------------------------------
# Recommendations progress — wizard state with promoted queryable columns
# ---------------------------------------------------------------------------

class UserRecommendationsProgressRecord(Base):
    """
    Tracks the user's position in the recommendations wizard.

    `step` and `current_area_index` are promoted to indexed columns so that
    analytics queries ("how many users are on step X") avoid full JSON scans.
    The full wizard state remains in `progress` JSON for the route layer.
    """
    __tablename__ = "user_recommendations_progress"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    # Promoted queryable fields
    step: Mapped[str] = mapped_column(String(50), nullable=False, default="intro", index=True)
    current_area_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Full wizard state (all other fields)
    progress: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=func.now(), onupdate=func.now())


# ---------------------------------------------------------------------------
# Completed growth areas
# ---------------------------------------------------------------------------

class CompletedGrowthAreaRecord(Base):
    __tablename__ = "completed_growth_areas"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    area_id: Mapped[str] = mapped_column(String(50), nullable=False)
    area_name: Mapped[str] = mapped_column(String(100), nullable=False)
    area_color: Mapped[str] = mapped_column(String(100), nullable=False)
    answers: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})
    recommendations: Mapped[list | None] = mapped_column(JSON)
    child_selections: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
    child_summary: Mapped[str | None] = mapped_column(Text)
    child_strengths: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
    child_suggested: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "area_id", name="uq_user_area"),
        Index("ix_growth_areas_user_created", "user_id", "created_at"),
    )


# ---------------------------------------------------------------------------
# Children — promoted queryable columns + flexible extra payload
# ---------------------------------------------------------------------------

class ChildRecord(Base):
    """
    Child profile.

    `name`, `age`, `school` are promoted from the old JSON payload blob to
    real columns so they can be indexed, sorted, and filtered at the DB level.
    All remaining flexible fields (avatar_style, interests, etc.) stay in
    `payload` JSON for schema-free evolution.
    """
    __tablename__ = "children"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # Promoted columns
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # age is a free-form string (e.g. "7", "7 years", "6–8") not an integer,
    # because the app accepts descriptive values from the onboarding flow.
    # If numeric range queries are ever needed, migrate this to Integer.
    age: Mapped[str | None] = mapped_column(String(20), nullable=True)
    school: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Remaining flexible fields
    payload: Mapped[dict] = mapped_column(JSON, default=lambda: {})
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_children_user_created", "user_id", "created_at"),
        Index("ix_children_user_name", "user_id", "name"),
    )


# ---------------------------------------------------------------------------
# Growth missions — promoted queryable columns + flexible extra payload
# ---------------------------------------------------------------------------

class GrowthMissionRecord(Base):
    """
    A single growth mission assigned to a child.

    `title`, `status`, and `pillar` are promoted from the JSON payload blob to
    real columns so mission lists can be filtered and sorted by status/pillar
    without fetching and parsing every row.
    All remaining flexible fields stay in `payload` JSON.
    """
    __tablename__ = "growth_missions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    child_id: Mapped[str] = mapped_column(String(36), ForeignKey("children.id", ondelete="CASCADE"), nullable=False)
    # Promoted columns
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active")
    pillar: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Remaining flexible fields
    payload: Mapped[dict] = mapped_column(JSON, default=lambda: {})
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_missions_child_created", "child_id", "created_at"),
        Index("ix_missions_child_status", "child_id", "status"),
    )

from datetime import datetime
import uuid

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, DateTime, JSON, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    jti: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False, default="Parent")
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="parent")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=func.now(), onupdate=func.now())


class UserPreferencesRecord(Base):
    __tablename__ = "user_preferences"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    tts_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_visited_path: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())


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
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())


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
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())


class UserJourneyRecord(Base):
    __tablename__ = "user_journey"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    overview: Mapped[str | None] = mapped_column(Text)
    focus_areas: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
    initial_missions: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())


class UserGoalsRecord(Base):
    __tablename__ = "user_goals"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    parent_concern: Mapped[str | None] = mapped_column(Text)
    goals_plan: Mapped[dict | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())


class UserRecommendationsProgressRecord(Base):
    __tablename__ = "user_recommendations_progress"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    progress: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())


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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "area_id", name="uq_user_area"),
        Index("ix_growth_areas_user_created", "user_id", "created_at"),
    )


# ---------------------------------------------------------------------------
# Children and missions
# ---------------------------------------------------------------------------

class ChildRecord(Base):
    __tablename__ = "children"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=lambda: {})
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (Index("ix_children_user_created", "user_id", "created_at"),)


class GrowthMissionRecord(Base):
    __tablename__ = "growth_missions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    child_id: Mapped[str] = mapped_column(String(36), ForeignKey("children.id", ondelete="CASCADE"), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=lambda: {})
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (Index("ix_missions_child_created", "child_id", "created_at"),)

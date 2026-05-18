from __future__ import annotations

import json
import re

from pydantic import BaseModel, Field, field_validator, model_validator

# Relative path: starts with a single /, no control chars, no protocol chars (:)
# and no characters that enable HTML/script injection or open-redirect via //host.
_SAFE_PATH_RE = re.compile(r'^/(?!/)[^\x00-\x1f\\<>"\':`]*$')


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------

class UserPreferences(BaseModel):
    tts_enabled: bool = True
    last_visited_path: str | None = None


class UserPreferencesPatch(BaseModel):
    tts_enabled: bool | None = None
    last_visited_path: str | None = Field(None, max_length=500)

    @field_validator("last_visited_path")
    @classmethod
    def validate_last_visited_path(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not _SAFE_PATH_RE.match(v):
            raise ValueError(
                "last_visited_path must be a relative path starting with '/' "
                "and must not contain control characters, backslashes, colons, or quotes"
            )
        return v


# ---------------------------------------------------------------------------
# Onboarding — child data
# ---------------------------------------------------------------------------

class OnboardingChildData(BaseModel):
    name: str = Field(default="", max_length=100)
    age: str = Field(default="", max_length=20)
    school: str = Field(default="", max_length=200)
    strengths: list[str] = Field(default_factory=list, max_length=20)
    hobbies: list[str] = Field(default_factory=list, max_length=20)
    thinking_pattern: str = Field(default="", max_length=100)
    communication_style: str = Field(default="", max_length=100)
    energy_level: str = Field(default="", max_length=100)
    social_behaviour: str = Field(default="", max_length=100)
    emotional_behaviour: str = Field(default="", max_length=100)


# ---------------------------------------------------------------------------
# Onboarding — personality analysis
# ---------------------------------------------------------------------------

class FamousPerson(BaseModel):
    name: str
    image: str = ""


class PersonalityProfile(BaseModel):
    name: str
    category: str
    description: str
    color: str = ""
    traits: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    growth_areas: list[str] = Field(default_factory=list)
    famous_people: list[FamousPerson] = Field(default_factory=list)


class PersonalityViewModel(BaseModel):
    type: str
    scores: dict[str, int] = Field(default_factory=dict, max_length=20)
    profile: PersonalityProfile


class PersonalityAnalysis(BaseModel):
    source: str
    view_model: PersonalityViewModel


# ---------------------------------------------------------------------------
# Onboarding — journey recommendations
# ---------------------------------------------------------------------------

class FocusArea(BaseModel):
    pillar: str
    focus: str
    why: str


class InitialMission(BaseModel):
    title: str
    description: str
    pillar: str


class JourneyRecommendations(BaseModel):
    pathway_overview: str
    focus_areas: list[FocusArea]
    initial_missions: list[InitialMission]


# ---------------------------------------------------------------------------
# Onboarding — aggregate state and patch
# ---------------------------------------------------------------------------

class OnboardingState(BaseModel):
    phase: int = 0
    child_data: OnboardingChildData | None = None
    personality: PersonalityAnalysis | None = None
    recommendations: JourneyRecommendations | None = None


class OnboardingPatch(BaseModel):
    phase: int | None = None
    child_data: OnboardingChildData | None = None
    personality: PersonalityAnalysis | None = None
    recommendations: JourneyRecommendations | None = None
    clear_child_data: bool = False
    clear_personality: bool = False
    clear_recommendations: bool = False


# ---------------------------------------------------------------------------
# Completed growth areas
# ---------------------------------------------------------------------------

class ChildActivityResults(BaseModel):
    summary: str = ""
    strengths: list[str] = Field(default_factory=list)
    suggested_activities: list[str] = Field(default_factory=list)


class ChildActivity(BaseModel):
    selections: list[str] = Field(default_factory=list)
    results: ChildActivityResults | None = None


class CompletedGrowthArea(BaseModel):
    area_id: str
    area_name: str
    area_color: str
    answers: dict[str, str] = Field(default_factory=dict)
    recommendations: list[str] | None = None
    child_activity: ChildActivity | None = None


class CompletedGrowthAreasResponse(BaseModel):
    areas: list[CompletedGrowthArea]


class AppendGrowthAreaRequest(BaseModel):
    area_id: str = Field(max_length=50)
    area_name: str = Field(max_length=100)
    area_color: str = Field(max_length=100)
    answers: dict[str, str] = Field(default_factory=dict, max_length=100)
    recommendations: list[str] | None = Field(None, max_length=50)
    child_activity: ChildActivity | None = None


# ---------------------------------------------------------------------------
# Recommendations progress
# ---------------------------------------------------------------------------

class GrowthAreaRef(BaseModel):
    id: str
    name: str
    color: str
    description: str = ""


class SelectedActivity(BaseModel):
    title: str
    description: str = ""
    duration: str = ""
    type: str = ""


class GeneratedActivity(BaseModel):
    title: str = ""
    description: str = ""
    instructions: list[str] = Field(default_factory=list)
    estimated_time: str = ""


class InteractiveDraft(BaseModel):
    question_id: str
    text: str


class AiThreeMonthRecs(BaseModel):
    area_id: str
    items: list[str]


class RecommendationsProgress(BaseModel):
    step: str = "intro"
    selected_area: GrowthAreaRef | None = None
    selected_activity: SelectedActivity | None = None
    parent_liked: bool | None = None
    want_child_activity: bool | None = None
    feedback: str = ""
    current_area_index: int = 0
    interactive_step: int = 0
    interactive_answers: dict[str, str] = Field(default_factory=dict, max_length=50)
    interactive_draft: InteractiveDraft | None = None
    generated_activity: GeneratedActivity | None = None
    show_game: bool = False
    child_activity_by_area: dict[str, ChildActivity] = Field(default_factory=dict, max_length=10)
    ai_three_month_recommendations: AiThreeMonthRecs | None = None


# ---------------------------------------------------------------------------
# Goals
# ---------------------------------------------------------------------------

class ActivityResponse(BaseModel):
    question: str
    answer: str | None = None
    type: str | None = None


class GoalsActivity(BaseModel):
    title: str
    objective: str
    scorable: bool = True
    completed: bool | None = None
    score: float | None = None
    note: str | None = None
    progress_observation: str | None = None
    ai_feedback: str | None = None
    parent_feedback: str | None = None
    responses: list[ActivityResponse] = []


class GoalsPeriod(BaseModel):
    label: str
    activities: list[GoalsActivity]


class GoalsMonth(BaseModel):
    month: int
    goal: str
    objective: str
    periods: list[GoalsPeriod]


class GoalsPlanMonthInsight(BaseModel):
    month: int
    insight: str


class InsightItem(BaseModel):
    text: str
    type: str
    details: str


class GoalsPlanInsights(BaseModel):
    schema_version: int | None = None
    overall_summary: str = ''
    monthly_insights: list[GoalsPlanMonthInsight] = []
    recommendations: list[str] = []
    strongest_area: str | None = None
    focus_area: str | None = None
    insight_items: list[InsightItem] = []


class GoalsPlan(BaseModel):
    months: list[GoalsMonth]
    insights: GoalsPlanInsights | None = None
    insights_signature: int | None = None


class UserGoals(BaseModel):
    parent_concern: str | None = None
    plan: GoalsPlan | None = None


class UserGoalsPatch(BaseModel):
    parent_concern: str | None = None
    plan: GoalsPlan | None = None
    clear_plan: bool = False
    clear_concern: bool = False


# ---------------------------------------------------------------------------
# Children
# ---------------------------------------------------------------------------

class ChildResponse(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    created_date: str
    name: str = ""
    age: str | int | None = None
    school: str | None = None
    date_of_birth: str | None = None
    current_phase: str | int | None = None
    onboarding_completed: bool | None = None
    personality_traits: list | None = None
    interests: list | None = None
    mbti_type: str | None = None
    avatar_style: str | None = None
    generated_profile: dict | None = None
    recommendations: dict | None = None
    strengths: list | None = None
    hobbies: list | None = None
    thinking_pattern: str | None = None
    communication_style: str | None = None
    energy_level: str | None = None
    social_behaviour: str | None = None
    emotional_behaviour: str | None = None


_PAYLOAD_MAX_BYTES = 65_536  # 64 KB limit for extra payload fields


class ChildCreate(BaseModel):
    # extra="allow" is intentional: unknown fields pass through to the JSON payload blob,
    # letting the frontend evolve fields without a backend migration. System fields
    # (id, created_date, user_id) must be stripped by the route handler before storage.
    model_config = {"extra": "allow"}

    name: str = Field(min_length=1, max_length=255)
    age: str | int | None = Field(None, max_length=20)
    school: str | None = Field(None, max_length=300)
    date_of_birth: str | None = None
    current_phase: str | int | None = None
    onboarding_completed: bool | None = None
    personality_traits: list | None = None
    interests: list | None = None
    mbti_type: str | None = None
    avatar_style: str | None = None
    generated_profile: dict | None = None
    recommendations: dict | None = None
    strengths: list | None = None
    hobbies: list | None = None
    thinking_pattern: str | None = None
    communication_style: str | None = None
    energy_level: str | None = None
    social_behaviour: str | None = None
    emotional_behaviour: str | None = None

    @model_validator(mode="after")
    def limit_extra_payload_size(self) -> "ChildCreate":
        if self.__pydantic_extra__:
            if len(json.dumps(self.__pydantic_extra__)) > _PAYLOAD_MAX_BYTES:
                raise ValueError("Child payload exceeds maximum allowed size (64 KB)")
        return self


class ChildPatch(BaseModel):
    # extra="allow": same payload-blob design as ChildCreate.
    model_config = {"extra": "allow"}

    name: str | None = None
    # Promoted columns — declared explicitly so max_length validation applies on the patch path.
    age: str | int | None = Field(None, max_length=20)
    school: str | None = Field(None, max_length=300)
    pillar_scores: dict | None = None
    total_missions_completed: int | None = None
    parent_interactions: list | None = None
    avatar_style: str | None = None

    @field_validator("pillar_scores")
    @classmethod
    def validate_pillar_scores(cls, v: dict | None) -> dict | None:
        if v is not None and len(v) > 20:
            raise ValueError("pillar_scores must not exceed 20 entries")
        return v

    @model_validator(mode="after")
    def limit_extra_payload_size(self) -> "ChildPatch":
        if self.__pydantic_extra__:
            if len(json.dumps(self.__pydantic_extra__)) > _PAYLOAD_MAX_BYTES:
                raise ValueError("Child payload exceeds maximum allowed size (64 KB)")
        return self


# ---------------------------------------------------------------------------
# Growth missions
# ---------------------------------------------------------------------------

class GrowthMissionResponse(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    child_id: str
    created_date: str
    title: str = ""
    description: str | None = None
    pillar: str | None = None
    status: str = "active"
    difficulty: str = "easy"
    week_number: int | None = None
    activity_type: str | None = None
    activity_data: dict | None = None


class GrowthMissionCreate(BaseModel):
    model_config = {"extra": "allow"}

    child_id: str = Field(max_length=36)
    title: str = Field(max_length=255)
    description: str | None = None
    pillar: str | None = Field(None, max_length=100)
    status: str = Field("active", max_length=50)
    difficulty: str = Field("easy", max_length=50)
    week_number: int | None = None
    activity_type: str | None = Field(None, max_length=100)
    activity_data: dict | None = None

    @model_validator(mode="after")
    def limit_extra_payload_size(self) -> "GrowthMissionCreate":
        if self.__pydantic_extra__:
            if len(json.dumps(self.__pydantic_extra__)) > _PAYLOAD_MAX_BYTES:
                raise ValueError("Mission payload exceeds maximum allowed size (64 KB)")
        return self


class BulkMissionBody(BaseModel):
    items: list[GrowthMissionCreate] = Field(min_length=1, max_length=50)

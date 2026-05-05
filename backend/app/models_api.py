from __future__ import annotations

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------

class UserPreferences(BaseModel):
    tts_enabled: bool = True


# ---------------------------------------------------------------------------
# Onboarding — child data
# ---------------------------------------------------------------------------

class OnboardingChildData(BaseModel):
    name: str = Field(default="", max_length=100)
    age: str = Field(default="", max_length=20)
    school: str = Field(default="", max_length=200)
    strengths: list[str] = Field(default_factory=list)
    hobbies: list[str] = Field(default_factory=list)
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
    scores: dict[str, int]  # dynamic personality-type keys — the only justified dict
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
    area_id: str
    area_name: str
    area_color: str
    answers: dict[str, str] = Field(default_factory=dict)
    recommendations: list[str] | None = None
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
    interactive_answers: dict[str, str] = Field(default_factory=dict)
    interactive_draft: InteractiveDraft | None = None
    generated_activity: GeneratedActivity | None = None
    show_game: bool = False
    child_activity_by_area: dict[str, ChildActivity] = Field(default_factory=dict)
    ai_three_month_recommendations: AiThreeMonthRecs | None = None


# ---------------------------------------------------------------------------
# Goals
# ---------------------------------------------------------------------------

class GoalsActivity(BaseModel):
    title: str
    objective: str
    scorable: bool = True
    completed: bool | None = None
    score: int | None = None
    note: str | None = None
    progress_observation: str | None = None
    ai_feedback: str | None = None
    parent_feedback: str | None = None


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


class GoalsPlanInsights(BaseModel):
    overall_summary: str = ''
    monthly_insights: list[GoalsPlanMonthInsight] = []
    recommendations: list[str] = []
    strongest_area: str | None = None
    focus_area: str | None = None


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
    model_config = {"extra": "allow"}

    id: str
    created_date: str
    name: str = ""
    age: str | int | None = None
    school: str | None = None
    date_of_birth: str | None = None
    current_phase: int | None = None
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


class ChildCreate(BaseModel):
    # extra="allow" is intentional: unknown fields pass through to the JSON payload blob,
    # letting the frontend evolve fields without a backend migration. System fields
    # (id, created_date, user_id) must be stripped by the route handler before storage.
    model_config = {"extra": "allow"}

    name: str = Field(min_length=1, max_length=255)
    age: str | int | None = None
    school: str | None = None
    date_of_birth: str | None = None
    current_phase: int | None = None
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


class ChildPatch(BaseModel):
    # extra="allow": same payload-blob design as ChildCreate.
    model_config = {"extra": "allow"}

    name: str | None = None
    pillar_scores: dict | None = None
    total_missions_completed: int | None = None
    parent_interactions: list | None = None
    avatar_style: str | None = None


# ---------------------------------------------------------------------------
# Growth missions
# ---------------------------------------------------------------------------

class GrowthMissionResponse(BaseModel):
    model_config = {"extra": "allow"}

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
    # extra="allow": same payload-blob design as ChildCreate.
    model_config = {"extra": "allow"}

    child_id: str
    title: str
    description: str | None = None
    pillar: str | None = None
    status: str = "active"
    difficulty: str = "easy"
    week_number: int | None = None
    activity_type: str | None = None
    activity_data: dict | None = None


class BulkMissionBody(BaseModel):
    items: list[GrowthMissionCreate] = Field(min_length=1, max_length=50)


class GrowthMissionPatch(BaseModel):
    # extra="allow": same payload-blob design as ChildCreate.
    model_config = {"extra": "allow"}

    status: str | None = None
    completed_date: str | None = None
    child_responses: list | None = None
    reflection: str | None = None
    learning_areas: str | None = None
    parent_observation: str | None = None
    ai_insights: dict | None = None


# ---------------------------------------------------------------------------
# Parent insights
# ---------------------------------------------------------------------------

class ParentInsightResponse(BaseModel):
    model_config = {"extra": "allow"}

    id: str
    child_id: str
    is_read: bool
    created_date: str
    insight_type: str | None = None
    title: str | None = None
    description: str | None = None
    action_suggestion: str | None = None


class UpdateInsightBody(BaseModel):
    is_read: bool = True


class ParentInsightCreate(BaseModel):
    # extra="allow": same payload-blob design as ChildCreate.
    model_config = {"extra": "allow"}

    child_id: str
    insight_type: str | None = None
    title: str | None = None
    description: str | None = None
    action_suggestion: str | None = None


# ---------------------------------------------------------------------------
# Reflections
# ---------------------------------------------------------------------------

class ReflectionResponse(BaseModel):
    model_config = {"extra": "allow"}

    id: str
    child_id: str
    created_date: str
    type: str | None = None
    content: str | None = None
    pillar_tags: list | None = None


class ReflectionCreate(BaseModel):
    # extra="allow": same payload-blob design as ChildCreate.
    model_config = {"extra": "allow"}

    child_id: str
    type: str | None = None
    content: str | None = None
    pillar_tags: list | None = None

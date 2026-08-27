export interface ErrorResponse {
  detail: string;
  status_code?: number;
}

export interface AllowedEmailRecord {
  email: string;
  added_at: string | null;
}

export interface AllowedEmailsPage {
  items: AllowedEmailRecord[];
  total: number;
  skip: number;
  limit: number;
}

export interface AdminUserRecord {
  id: string;
  email: string | null;
  full_name: string | null;
  location: string | null;
  created_at: string | null;
  locked: boolean;
}

export interface AdminUsersPage {
  items: AdminUserRecord[];
  total: number;
  skip: number;
  limit: number;
}

export interface UserRecord {
  role?: string;
  full_name?: string;
  email?: string;
  [key: string]: unknown;
}

export interface ChildRecord {
  id: string;
  name?: string;
  age?: number | string;
  school?: string;
  strengths?: string[];
  hobbies?: string[];
  thinking_pattern?: string;
  communication_style?: string;
  energy_level?: string;
  social_behaviour?: string;
  emotional_behaviour?: string;
  current_phase?: string;
  onboarding_completed?: boolean;
  onboarding_phase?: number;
  /** Personality Journey progression flags — see the comment on ChildResponse in backend/app/schemas/children.py for the full ordered chain. */
  onboarding_profile_completed?: boolean;
  conversational_onboarding_completed?: boolean;
  discover_completed?: boolean;
  grow_completed?: boolean;
  transform_visited?: boolean;
  release_visited?: boolean;
  connect_visited?: boolean;
  personality?: {
    source?: string;
    view_model?: {
      type?: string;
      profile?: Record<string, unknown>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  recommendations?: Record<string, unknown>;
  /** job_type → job_id for any LLM jobs currently in flight for this child */
  active_jobs?: Record<string, string>;
  is_deleted?: boolean;
  deleted_at?: string | null;
  [key: string]: unknown;
}

// Must stay in sync with JobType in backend/app/models_api.py — the backend
// rejects any value it does not declare.
export type JobType =
  | 'generate_recommendations'
  | 'generate_goals_plan'
  | 'generate_activity'
  | 'generate_personality_analysis'
  | 'generate_journey_insights'
  | 'generate_life_pathway'
  | 'generate_growth_parent_questions'
  | 'generate_growth_child_rounds'
  | 'generate_observations';

export type JobStatus = 'pending' | 'processing' | 'result_ready' | 'completed' | 'failed';

export interface JobStatusRecord {
  job_id: string;
  status: JobStatus;
  error?: string;
  created_at: string;
}

export interface EnqueueJobPayload {
  type: JobType;
  child_id: string;
  payload: {
    prompt: string;
    response_json_schema?: Record<string, unknown>;
    provider?: string;
  };
  write_back: {
    collection:
      | 'growth_areas'
      | 'children'
      | 'goals'
      | 'goal_months'
      | 'goal_insights'
      | 'observations';
    filter: Record<string, unknown>;
    field: string;
  };
}

export interface EnqueueJobResponse {
  job_id: string;
}

export interface PreferencesRecord {
  tts_enabled?: boolean;
  last_visited_path?: string;
  [key: string]: unknown;
}

export interface GoalsRecord {
  parent_concern?: string;
  goals_plan?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface GoalsActivity {
  title: string;
  objective: string;
  scorable?: boolean;
  completed?: boolean | null;
  score?: number | null;
  note?: string | null;
  progress_observation?: string | null;
  ai_feedback?: string | null;
  parent_feedback?: string | null;
  what_changed?: string | null;
  what_learned?: string | null;
  recommendation?: string | null;
  answers_text?: string | null;
}

export interface GoalsPeriod {
  label: string;
  activities: GoalsActivity[];
}

export interface GoalsMonth {
  month: number;
  goal: string;
  objective: string;
  periods: GoalsPeriod[];
}

export interface GoalMonthsRecord {
  months: GoalsMonth[];
  [key: string]: unknown;
}

export interface InsightItem {
  text: string;
  type: string;
  details: string;
}

export interface GoalInsightsRecord {
  schema_version?: number | null;
  insight_items?: InsightItem[];
  insights_signature?: number | null;
  /** Staging field: full LLM response written by worker; promoted to insight_items by finalizeInsights. */
  pending_insights?: { insight_items?: InsightItem[]; [key: string]: unknown } | null;
  [key: string]: unknown;
}

/**
 * The Release page's observations document — its own collection keyed by child_id,
 * alongside goals and goal_insights rather than embedded on the child.
 */
export interface ObservationsRecord {
  source?: string | null;
  /**
   * Raw provider objects. Always read through normalizeObservations in
   * `@/lib/observationsData` rather than trusting the shape.
   */
  items?: unknown;
  /** Observation ids the parent ticked. */
  watching?: string[];
  /** SPANS label the parent chose, e.g. "3 months". */
  span?: string | null;
  /** When Start tracking was last pressed. Written but not yet read by anything. */
  started_at?: string | null;
  /** Staging field: raw generate_observations output, promoted by finalizeObservations. */
  pending_observations?: Record<string, unknown> | null;
  [key: string]: unknown;
}

/**
 * A stored recommendation. Areas completed before the Growth Areas redesign —
 * and anything the onboarding RecommendationsPhase writes — hold plain strings;
 * the redesigned flow writes { title, detail }. Both shapes coexist and neither
 * is migrated, so always read through normalizeRecommendations() in
 * `@/lib/growthAreaData` rather than touching these values directly.
 */
export type StoredRecommendation = string | { title?: string; detail?: string };

export interface CompletedArea {
  status?: string;
  area_id?: string;
  area_name?: string;
  area_color?: string;
  step?: string;
  /** Written only by the onboarding flow — always plain strings. */
  recommendations?: string[];
  ai_three_month_recommendations?: StoredRecommendation[];
  answers?: Record<string, unknown>;
  interactive_answers?: Record<string, unknown>;
  child_activity?: Record<string, unknown>;
  child_activity_selections?: string[];
  /**
   * The two question sets this area was presented with, generated once per child
   * per area by the generate_growth_parent_questions / generate_growth_child_rounds
   * jobs. Raw provider output — always read through normalizeGeneratedQuestions /
   * normalizeGeneratedRounds in `@/lib/growthAreaData` rather than trusting the
   * shape. `answers` and `child_activity.selections` above are keyed by ids
   * derived from these, so the three belong together on one document.
   */
  parent_questions?: Record<string, unknown>;
  child_rounds?: Record<string, unknown>;
  /**
   * Life Pathway milestone narrative for this area, written by the
   * generate_life_pathway job and grounded in this document's own answers and
   * recommendations. Raw provider output — read it through
   * normalizeLifePathwayArea in `@/lib/lifePathwayData`.
   */
  life_pathway_milestones?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CompletedGrowthAreasRecord {
  areas?: CompletedArea[];
  [key: string]: unknown;
}

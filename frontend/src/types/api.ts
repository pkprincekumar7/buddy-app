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

export type JobType =
  | 'generate_recommendations'
  | 'generate_goals_plan'
  | 'generate_activity'
  | 'generate_personality_analysis'
  | 'generate_journey_recommendations'
  | 'generate_journey_insights';

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
    collection: 'growth_areas' | 'children' | 'goals' | 'goal_months' | 'goal_insights';
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
  [key: string]: unknown;
}

export interface CompletedGrowthAreasRecord {
  areas?: CompletedArea[];
  [key: string]: unknown;
}

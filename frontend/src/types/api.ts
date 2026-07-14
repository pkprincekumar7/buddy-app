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
    collection: 'growth_areas' | 'children' | 'goals';
    filter: Record<string, unknown>;
    field: string;
  };
}

export interface EnqueueJobResponse {
  job_id: string;
}

export interface PreferencesRecord {
  tts_enabled?: boolean;
  dark_mode?: boolean;
  last_visited_path?: string;
  [key: string]: unknown;
}

export interface GoalsRecord {
  parent_concern?: string;
  goals_plan?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface GoalMonthsRecord {
  months: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface GoalInsightsRecord {
  schema_version?: number | null;
  insight_items?: unknown[];
  insights_signature?: number | null;
  [key: string]: unknown;
}

export interface CompletedArea {
  status?: string;
  area_id?: string;
  area_name?: string;
  area_color?: string;
  step?: string;
  recommendations?: string[];
  ai_three_month_recommendations?: string[];
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

// Shared domain types used across client and server.

export type UnitPref = "metric" | "imperial";
export type Sex = "male" | "female" | "unspecified";
export type GoalType = "recomp" | "bulk" | "cut" | "maintain" | "auto";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "very";

// AI-estimated micronutrients, keyed by name -> amount with unit (e.g. "Vitamin C": "45mg").
export type Vitamins = Record<string, string>;

export interface Profile {
  user_id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  age: number | null;
  height_cm: number | null;
  sex: Sex | null;
  build_note: string | null;
  activity_level: ActivityLevel | null;
  daily_steps: number | null;
  unit_pref: UnitPref;
  onboarded: boolean;
  start_date: string;
  end_goal: string | null;
  end_goal_target_date: string | null;
  end_goal_set_at: string | null;
  created_at: string;
}

export interface Goal {
  id: string;
  user_id: string;
  effective_from: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  goal_type: GoalType;
  source: "onboarding" | "7day_checkin" | "manual_settings";
  activity_level: ActivityLevel | null;
  body_fat_estimate: string | null;
  body_type_read: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export interface FoodItem {
  name: string;
  grams: number | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  assumption: string | null;
}

export interface FoodTotals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface FoodParseResult {
  items: FoodItem[];
  totals: FoodTotals;
  vitamins: Vitamins; // aggregated micronutrient estimate for the whole entry
  notes: string[];
}

export interface FoodLog {
  id: string;
  user_id: string;
  date: string;
  meal_label: string | null;
  raw_input: string | null;
  photo_url: string | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  items_json: FoodItem[] | null;
  vitamins_json: Vitamins | null;
  created_at: string;
}

export type ExerciseType = "strength" | "cardio" | "rest" | "other";

// One logged set. weight_kg is the number the user stated; if each_side is true
// (dumbbell "12.5kg each side") the effective load per rep is 2× that — the
// workout math accounts for it, the UI shows "12.5 kg each".
export interface ExerciseSet {
  weight_kg: number | null;
  reps: number;
  each_side?: boolean;
}

export interface ParsedStrengthExercise {
  name: string;
  primary_muscle?: string;
  secondary_muscles?: string[];
  // Canonical per-set data for new logs.
  set_list?: ExerciseSet[];
  volume?: number | null;
  // Set when the exercise was picked from the exercise library during a live
  // workout: `${id}-${media_id}` addresses its GIF/thumbnail on the media CDN.
  media?: string | null;
  // Legacy aggregate shape (older logs / fallback). Still read by the
  // normalizer in lib/workout.ts so old entries keep rendering.
  sets?: number;
  reps?: number;
  weight_kg?: number | null;
}

// AI-generated, cached once per workout so we never re-bill on re-open.
export interface WorkoutIntelligence {
  narrative?: string; // "Explain My Workout"
  recovery?: string; // protein/calorie + dinner suggestion
  exercise_insights?: Record<string, string>; // exercise name -> one-line insight
  generated_at?: string;
}

export interface ParsedExercise {
  type: ExerciseType;
  workout_name?: string; // e.g. "Push Day"
  muscle_groups?: string[]; // e.g. ["Chest", "Shoulders", "Triceps"]
  exercises: ParsedStrengthExercise[]; // strength
  cardio?: { activity: string; duration_min: number | null; distance_km: number | null } | null;
  est_calories: number | null;
  est_duration_min?: number | null;
  summary: string;
  intelligence?: WorkoutIntelligence;
}

export interface ExerciseLog {
  id: string;
  user_id: string;
  date: string;
  type: ExerciseType;
  raw_input: string | null;
  parsed_json: ParsedExercise | null;
  est_calories: number | null;
  created_at: string;
}

export interface ExerciseConfig {
  user_id: string;
  weekly_target_sessions: number;
  split_pattern: string | null;
  cardio_target_per_week: number | null;
}

export interface Streak {
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_log_date: string | null;
  total_days_logged: number;
}

export interface WeighIn {
  id: string;
  user_id: string;
  date: string;
  weight_kg: number;
  photo_url: string | null;
  note: string | null;
}

export interface MedicalDocument {
  id: string;
  user_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  text_content: string | null;
  created_at: string;
}

// A user-added exercise that wasn't in the bundled library. Lives in Supabase
// so it appears in the picker on every device, marked "custom" (no GIF).
export interface CustomExercise {
  id: string;
  user_id: string;
  name: string;
  body_part: string;
  equipment: string;
  target: string;
  created_at: string;
}

// ---- AI Coach plans (30-day meal & training plans) ----

export type PlanKind = "meal" | "workout";
export type PlanStatus = "active" | "stopped" | "completed";

export interface AiPlan {
  id: string;
  user_id: string;
  kind: PlanKind;
  status: PlanStatus;
  start_date: string;
  end_date: string;
  context_summary: string | null; // what the AI understood from the 30-day history
  meta: Record<string, unknown> | null;
  created_at: string;
}

// One suggested meal in a plan day. Recipe/image are attached server-side by
// matching the dish against the Indian recipe dataset; both may be absent.
export interface PlanMeal {
  slot: string; // breakfast | lunch | snack | dinner
  name: string;
  desc: string;
  portion: string; // e.g. "2 rotis + 1 katori dal"
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  verified?: boolean; // macros grounded in the INDB dataset
  image_key?: string | null; // slug in the food-media storage cache
  image_src?: string | null; // original dataset image URL (fallback)
  recipe?: { steps: string[]; time_min: number | null } | null;
}

export interface MealDayPayload {
  meals: PlanMeal[];
  totals: FoodTotals;
  note?: string | null; // one-line coach note for the day
}

export interface PlanExercise {
  name: string;
  sets: number;
  reps: number;
  weight_kg: number | null; // null = bodyweight / user's choice
  note?: string | null; // e.g. "up 2.5kg from last week"
  media?: string | null; // exercise-library media key (GIF/thumb)
  primary_muscle?: string | null;
  steps?: string[]; // how-to, from the exercise library
}

export interface WorkoutDayPayload {
  kind: "workout" | "rest";
  name: string; // "Push Day" / "Rest"
  focus?: string[];
  exercises: PlanExercise[];
  note?: string | null;
}

export interface AiPlanDay {
  id: string;
  plan_id: string;
  user_id: string;
  date: string;
  day_index: number; // 1..30
  payload: MealDayPayload | WorkoutDayPayload;
  completed: boolean;
  completed_at: string | null;
  photo_url: string | null; // gamified daily photo check-in
  actual: {
    checked?: boolean[]; // per-meal ticks
    exercise_log_id?: string; // workout logged into the real tracker
    food_log_ids?: string[]; // meals logged into the real tracker
  } | null;
}

// Body analysis result (Claude) — onboarding and 7-day check-in.
export interface BodyAnalysis {
  body_fat_estimate: string; // a range, e.g. "14-17%"
  confidence_note: string;
  body_type_read: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  goal_type: GoalType;
  activity_level?: ActivityLevel;
  assessment?: string; // check-in only
  rationale: string;
}

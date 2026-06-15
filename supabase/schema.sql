-- ============================================================================
-- Daily Intake — Supabase schema
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Single-user app: every table is keyed to auth.uid() and locked with RLS so a
-- row is only ever visible to the user who owns it.
-- ============================================================================

-- ---------- profiles ----------
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  name         text,
  first_name   text,
  last_name    text,
  age          int,
  height_cm    numeric,
  sex          text,                         -- 'male' | 'female' | 'unspecified'
  build_note   text,
  activity_level text,                         -- sedentary | light | moderate | very
  daily_steps  int,
  unit_pref    text not null default 'metric', -- 'metric' | 'imperial'
  onboarded    boolean not null default false,
  start_date   date not null default current_date, -- day 1, drives the day counter
  created_at   timestamptz not null default now()
);

-- ---------- goals (versioned, never overwritten) ----------
create table if not exists public.goals (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  effective_from    date not null default current_date,
  calories          numeric not null,
  protein_g         numeric not null,
  carbs_g           numeric not null,
  fat_g             numeric not null,
  goal_type         text not null,           -- recomp | bulk | cut | maintain | auto
  source            text not null,           -- onboarding | 7day_checkin | manual_settings
  activity_level    text,                    -- sedentary | light | moderate | very
  body_fat_estimate text,                    -- e.g. "14-17%"
  body_type_read    text,
  notes             text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);
create index if not exists goals_user_active_idx on public.goals(user_id, is_active);

-- ---------- weigh_ins ----------
create table if not exists public.weigh_ins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  date       date not null default current_date,
  weight_kg  numeric not null,
  photo_url  text,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists weigh_ins_user_date_idx on public.weigh_ins(user_id, date);

-- ---------- food_logs ----------
create table if not exists public.food_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null default current_date,
  meal_label  text,
  raw_input   text,
  photo_url   text,
  calories    numeric not null default 0,
  protein_g   numeric not null default 0,
  carbs_g     numeric not null default 0,
  fat_g       numeric not null default 0,
  items_json  jsonb,                          -- per-item breakdown from the AI
  vitamins_json jsonb,                         -- AI-estimated vitamins/minerals for the entry
  created_at  timestamptz not null default now()
);
create index if not exists food_logs_user_date_idx on public.food_logs(user_id, date);

-- ---------- exercise_logs ----------
create table if not exists public.exercise_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  date         date not null default current_date,
  type         text not null default 'strength', -- strength | cardio | rest | other
  raw_input    text,
  parsed_json  jsonb,
  est_calories numeric,
  created_at   timestamptz not null default now()
);
create index if not exists exercise_logs_user_date_idx on public.exercise_logs(user_id, date);

-- ---------- exercise_config (one row per user) ----------
create table if not exists public.exercise_config (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  weekly_target_sessions int not null default 4,
  split_pattern          text,               -- "PPL,rest" etc, freeform but structured
  cardio_target_per_week int,
  updated_at             timestamptz not null default now()
);

-- ---------- streaks (one row per user) ----------
create table if not exists public.streaks (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  current_streak   int not null default 0,
  longest_streak   int not null default 0,
  last_log_date    date,
  total_days_logged int not null default 0
);

-- ---------- medical_documents ----------
create table if not exists public.medical_documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   int not null,
  storage_path text not null,
  text_content text,
  created_at   timestamptz not null default now()
);
create index if not exists medical_documents_user_created_idx on public.medical_documents(user_id, created_at desc);

-- ============================================================================
-- Row Level Security: each user sees only their own rows.
-- ============================================================================
alter table public.profiles       enable row level security;
alter table public.goals          enable row level security;
alter table public.weigh_ins      enable row level security;
alter table public.food_logs      enable row level security;
alter table public.exercise_logs  enable row level security;
alter table public.exercise_config enable row level security;
alter table public.streaks        enable row level security;
alter table public.medical_documents enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','goals','weigh_ins','food_logs','exercise_logs','exercise_config','streaks','medical_documents'
  ] loop
    execute format('drop policy if exists "own rows select" on public.%I;', t);
    execute format('drop policy if exists "own rows insert" on public.%I;', t);
    execute format('drop policy if exists "own rows update" on public.%I;', t);
    execute format('drop policy if exists "own rows delete" on public.%I;', t);
    execute format(
      'create policy "own rows select" on public.%I for select using (auth.uid() = user_id);', t);
    execute format(
      'create policy "own rows insert" on public.%I for insert with check (auth.uid() = user_id);', t);
    execute format(
      'create policy "own rows update" on public.%I for update using (auth.uid() = user_id);', t);
    execute format(
      'create policy "own rows delete" on public.%I for delete using (auth.uid() = user_id);', t);
  end loop;
end $$;

-- ============================================================================
-- Storage bucket for private photos (progress + food + check-in).
-- Bucket is private; only the owner can read/write their own folder (user_id/...).
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "own photos all" on storage.objects;
create policy "own photos all" on storage.objects
  for all
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================================
-- Storage bucket for private medical documents.
-- Bucket is private; only the owner can read/write their own folder (user_id/...).
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('medical-documents', 'medical-documents', false)
on conflict (id) do nothing;

drop policy if exists "own medical documents all" on storage.objects;
create policy "own medical documents all" on storage.objects
  for all
  using (bucket_id = 'medical-documents' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'medical-documents' and (storage.foldername(name))[1] = auth.uid()::text);

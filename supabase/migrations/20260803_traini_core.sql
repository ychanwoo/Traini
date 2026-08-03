create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '영찬',
  avatar_url text,
  target_distance text,
  target_time_seconds integer,
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.garmin_connections (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  garmin_user_id text unique,
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  expires_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.garmin_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  recorded_on date not null,
  vo2_max numeric,
  average_heart_rate numeric,
  average_pace_seconds_per_km integer,
  sleep_score integer,
  hrv_status text check (hrv_status in ('low', 'normal', 'high')),
  weekly_distance_km numeric,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, recorded_on)
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  garmin_activity_id text not null,
  activity_type text not null,
  started_at timestamptz not null,
  distance_meters numeric,
  duration_seconds integer,
  average_heart_rate numeric,
  average_pace_seconds_per_km integer,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, garmin_activity_id)
);

create table if not exists public.training_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  target_distance_km numeric not null,
  recovery_label text not null,
  created_at timestamptz not null default now(),
  unique (user_id, starts_on)
);

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.training_plans(id) on delete cascade,
  scheduled_on date not null,
  kind text not null check (kind in ('rest', 'easy', 'threshold', 'interval', 'long')),
  status text not null check (status in ('completed', 'today', 'scheduled', 'skipped')),
  title text not null,
  purpose text not null,
  distance_km numeric,
  target_pace text,
  target_heart_rate text,
  completed_activity_id uuid references public.activities(id),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.garmin_connections enable row level security;
alter table public.garmin_snapshots enable row level security;
alter table public.activities enable row level security;
alter table public.training_plans enable row level security;
alter table public.workouts enable row level security;

create policy "profile owner access" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "garmin connection owner access" on public.garmin_connections for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "snapshot owner access" on public.garmin_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "activity owner access" on public.activities for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "plan owner access" on public.training_plans for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "workout owner access" on public.workouts for select using (exists (select 1 from public.training_plans p where p.id = plan_id and p.user_id = auth.uid()));

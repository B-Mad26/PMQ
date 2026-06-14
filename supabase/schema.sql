-- PM Quest — database schema
-- Run in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Idempotent: safe to re-run.
--
-- Model mirrors the app's `pmq_state` object:
--   auth {name,email}, pmp, level, streak, premium, certified, score,
--   solved[], badges[], log[{title,pts}], mastery{risk,stake,plan,agile,budget}
--
-- Auth itself is handled by Supabase Auth (auth.users). The tables below hang
-- off auth.users.id and are protected by row-level security so each signed-in
-- user can only read/write their own rows.

-- ---------------------------------------------------------------------------
-- profiles: 1 row per user. Holds the headline progression + entitlement flag.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text,
  email       text,
  pmp         integer not null default 0,
  level       integer not null default 1,
  streak      integer not null default 0,
  score       integer not null default 0,
  premium     boolean not null default false,   -- entitlement (paid)
  certified   boolean not null default false,
  badges      text[]  not null default '{}',
  mastery     jsonb   not null default '{"risk":20,"stake":20,"plan":30,"agile":15,"budget":10}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- progress: one row per solved scenario (the `solved[]` + `log[]` arrays).
-- ---------------------------------------------------------------------------
create table if not exists public.progress (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  scenario_id   text not null,
  title         text,
  domain        text,
  points        integer not null default 0,
  first_try     boolean,
  solved_at     timestamptz not null default now(),
  unique (user_id, scenario_id)
);
create index if not exists progress_user_idx on public.progress (user_id);

-- ---------------------------------------------------------------------------
-- entitlements: durable record of what a user has paid for / been granted.
-- The `premium` flag on profiles is the fast-read denormalization of this.
-- ---------------------------------------------------------------------------
create table if not exists public.entitlements (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  product       text not null default 'certification_track',
  source        text,                       -- 'stripe', 'manual', 'referral', ...
  reference     text,                       -- e.g. Stripe payment/session id
  active        boolean not null default true,
  granted_at    timestamptz not null default now(),
  unique (user_id, product)
);
create index if not exists entitlements_user_idx on public.entitlements (user_id);

-- ---------------------------------------------------------------------------
-- certificates: issued when a user passes the exam. Shareable via public id.
-- ---------------------------------------------------------------------------
create table if not exists public.certificates (
  id            uuid primary key default gen_random_uuid(),  -- public, shareable
  user_id       uuid not null references auth.users (id) on delete cascade,
  recipient     text not null,              -- name printed on the cert
  score         integer,
  issued_at     timestamptz not null default now()
);
create index if not exists certificates_user_idx on public.certificates (user_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger for profiles
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create a profile row when a new auth user signs up.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row-level security: each user sees only their own rows.
-- ---------------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.progress     enable row level security;
alter table public.entitlements enable row level security;
alter table public.certificates enable row level security;

-- profiles
drop policy if exists "own profile read"   on public.profiles;
drop policy if exists "own profile write"  on public.profiles;
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile read"   on public.profiles for select using (auth.uid() = id);
create policy "own profile write"  on public.profiles for update using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);

-- progress
drop policy if exists "own progress read"   on public.progress;
drop policy if exists "own progress write"  on public.progress;
create policy "own progress read"  on public.progress for select using (auth.uid() = user_id);
create policy "own progress write" on public.progress for insert with check (auth.uid() = user_id);

-- entitlements: readable by owner; writes happen server-side (service role
-- bypasses RLS), so no client insert/update policy is granted here.
drop policy if exists "own entitlements read" on public.entitlements;
create policy "own entitlements read" on public.entitlements for select using (auth.uid() = user_id);

-- certificates: owner can read + create their own; public read-by-id is handled
-- via a server route using the service role, not exposed through RLS here.
drop policy if exists "own certificates read"  on public.certificates;
drop policy if exists "own certificates write" on public.certificates;
create policy "own certificates read"  on public.certificates for select using (auth.uid() = user_id);
create policy "own certificates write" on public.certificates for insert with check (auth.uid() = user_id);

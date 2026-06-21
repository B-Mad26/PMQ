-- B2B interest capture (Phase 0). Run in the Supabase SQL editor.
-- Writes happen server-side via /api/team-lead using the service role,
-- so no client policies are granted — leads are not readable by anon.

create table if not exists public.team_leads (
  id          bigint generated always as identity primary key,
  email       text not null,
  company     text,
  seats       text,
  source      text,
  created_at  timestamptz not null default now()
);

alter table public.team_leads enable row level security;
-- (intentionally no policies: only the service-role key can read/write this table)

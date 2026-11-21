-- ============================================================================
-- Migration 029: Morning briefing via the ARK Telegram bot
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 028_inbox_smart_filing.sql have already been applied. Safe to
-- re-run — every statement uses IF EXISTS/IF NOT EXISTS.
--
--   1. profiles.briefing_enabled / briefing_weekdays_only — personal
--      preference toggles (Settings → My Profile), same spirit as the
--      existing telegram_user_id column (022_telegram_inbox.sql):
--      never activity-logged, same as that column.
--   2. briefing_sends — one row per (profile, calendar day) a briefing
--      was actually sent for, so a retried cron run (app/api/cron/
--      morning-briefing/route.ts) never double-sends. RLS: admins can
--      read (to see who's getting briefings and when); there is no
--      insert/update/delete policy for `authenticated` at all — the
--      cron route writes through the service-role client, which
--      bypasses RLS entirely, so this table is never writable from a
--      logged-in session no matter who it belongs to. No new
--      activity_log entity_type is introduced, so
--      activity_log_entity_type_check is untouched.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. profiles.briefing_enabled / briefing_weekdays_only
-- ----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists briefing_enabled boolean not null default true;

alter table public.profiles
  add column if not exists briefing_weekdays_only boolean not null default false;

-- ----------------------------------------------------------------------------
-- 2. briefing_sends
-- ----------------------------------------------------------------------------

create table if not exists public.briefing_sends (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  briefing_date date not null,
  sent_at timestamptz not null default now(),
  unique (profile_id, briefing_date)
);

create index if not exists briefing_sends_profile_id_idx on public.briefing_sends (profile_id);

alter table public.briefing_sends enable row level security;

drop policy if exists "briefing_sends_select_admin" on public.briefing_sends;
create policy "briefing_sends_select_admin"
  on public.briefing_sends for select
  to authenticated
  using (public.is_registered_user() and public.is_admin());

revoke all on public.briefing_sends from anon;

commit;

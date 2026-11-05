-- ============================================================================
-- Migration 012: User management (Settings → Users, admin only)
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 011_settings_tables.sql have already been applied. Safe to
-- re-run: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF
-- EXISTS throughout.
--
-- What this does
-- --------------
-- 1. profiles: adds `active` (default true) and `must_change_password`
--    (default false).
-- 2. is_registered_user() now also requires active = true — since every
--    RLS policy in this entire schema is gated on that one function, a
--    deactivated user loses all data access immediately and everywhere,
--    the instant their row is deactivated, with no extra policy changes
--    needed anywhere else.
-- 3. Two new BEFORE UPDATE triggers on profiles:
--      - protect_profile_admin_fields(): supersedes 011's
--        protect_profile_role() — a non-admin session (auth.uid() is
--        not null and not is_admin()) can never change role or active,
--        and can never SET must_change_password to true. It CAN still
--        clear must_change_password from true to false on its own row
--        — that's the self-service "I just changed my temporary
--        password" step (components/settings/change-password-form.tsx),
--        which must work for a brand-new, still-non-admin user.
--      - protect_last_active_admin(): regardless of who's asking
--        (including the service-role key user-management actions use —
--        this check is unconditional, not gated on auth.uid()), refuses
--        to demote or deactivate the last remaining active admin.
-- 4. Widens activity_log's entity_type check to add 'user'. No new
--    trigger function is needed for logging user-management events,
--    unlike backup/password-change in 007/009: those needed a
--    SECURITY DEFINER RPC specifically because an ordinary signed-in
--    browser session (the `authenticated` role) has no INSERT policy
--    on activity_log. User-management actions run entirely server-side
--    through the service-role key (lib/supabase/service.ts), which
--    bypasses RLS outright, so lib/actions/users.ts just inserts the
--    activity_log row directly.
-- ============================================================================

alter table public.profiles
  add column if not exists active boolean not null default true;

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

create or replace function public.is_registered_user()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and active = true
  );
$$;

drop trigger if exists profiles_protect_role on public.profiles;
drop function if exists public.protect_profile_role();

create or replace function public.protect_profile_admin_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $protect_profile_admin_fields$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only an admin can change a profile role.';
    end if;
    if new.active is distinct from old.active then
      raise exception 'Only an admin can change a profile''s active status.';
    end if;
    -- Setting it is admin-only; clearing it (true -> false) on your own
    -- row is how a forced password change completes itself, and must
    -- stay allowed for a non-admin.
    if new.must_change_password is distinct from old.must_change_password and new.must_change_password then
      raise exception 'Only an admin can require a password change.';
    end if;
  end if;
  return new;
end;
$protect_profile_admin_fields$;

create trigger profiles_protect_admin_fields
  before update on public.profiles
  for each row
  execute function public.protect_profile_admin_fields();

create or replace function public.protect_last_active_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $protect_last_active_admin$
begin
  -- Only matters when a row that WAS an active admin is about to stop
  -- being one (demoted, deactivated, or both) — checked unconditionally
  -- (not gated on auth.uid()/is_admin()) so this holds even against the
  -- service-role key the Users admin actions use.
  if old.role = 'admin' and old.active = true
     and (new.role is distinct from 'admin' or new.active = false) then
    if not exists (
      select 1 from public.profiles
       where role = 'admin' and active = true and id <> old.id
    ) then
      raise exception 'There must always be at least one active admin.';
    end if;
  end if;
  return new;
end;
$protect_last_active_admin$;

drop trigger if exists profiles_protect_last_active_admin on public.profiles;
create trigger profiles_protect_last_active_admin
  before update on public.profiles
  for each row
  execute function public.protect_last_active_admin();

alter table public.activity_log
  drop constraint if exists activity_log_entity_type_check;

alter table public.activity_log
  add constraint activity_log_entity_type_check
  check (entity_type in (
    'project', 'contact', 'project_document', 'contact_product', 'contact_document',
    'project_step', 'backup', 'password_change', 'product', 'document_type', 'app_settings',
    'user'
  ));

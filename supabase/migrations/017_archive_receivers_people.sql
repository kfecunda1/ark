-- ============================================================================
-- Migration 017: Archive for Receivers and Contacts (people); delete
-- restricted to admins
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 016_receivers_and_people.sql have already been applied.
--
-- Wrapped in BEGIN/COMMIT so the whole thing is all-or-nothing. Safe to
-- run more than once: every statement uses IF NOT EXISTS / CREATE OR
-- REPLACE / DROP ... IF EXISTS guards.
--
-- No new activity_log entity types and no data migration — both new
-- columns default to null (active), so there's nothing to backfill and
-- no ordering hazard around existing triggers; log_contact_activity()
-- and log_person_activity() are simply redefined (CREATE OR REPLACE,
-- same triggers already attached) to report archived_at changes, the
-- same "before/after pair, column itself excluded from the generic
-- fields list" treatment projects.archived_at already gets.
--
--   1. contacts.archived_at, people.archived_at — both nullable
--      timestamptz, null = active, mirroring projects.archived_at
--      exactly (same column name, same "null means active" meaning).
--   2. Redefine log_contact_activity() / log_person_activity() to
--      report archived_at changes.
--   3. Restrict the contacts/people DELETE RLS policies to admins —
--      app-level delete is also admin-gated, but the policy is the
--      real enforcement; a non-admin's delete request must fail at
--      the database regardless of what the UI shows.
-- ============================================================================

begin;

-- ============================================================================
-- 1. archived_at columns
-- ============================================================================

alter table public.contacts
  add column if not exists archived_at timestamptz;

create index if not exists contacts_archived_at_idx on public.contacts (archived_at);

alter table public.people
  add column if not exists archived_at timestamptz;

create index if not exists people_archived_at_idx on public.people (archived_at);

-- ============================================================================
-- 2a. log_contact_activity(): report archived_at changes, same
--     before/after-pair treatment as projects.archived_at.
-- ============================================================================

create or replace function public.log_contact_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_contact_activity$
declare
  v_actor_id uuid;
  v_actor_label text;
  v_entity_id uuid;
  v_action text;
  v_summary text;
  v_details jsonb;
  v_changed text[];
begin
  if tg_op = 'INSERT' then
    v_entity_id := new.id;
    v_action := 'created';
    v_summary := nullif(btrim(new.full_name), '');
    v_details := '{}'::jsonb;

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new), array['archived_at']);

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := nullif(btrim(new.full_name), '');
    v_details := jsonb_build_object('fields', to_jsonb(v_changed));

    if new.full_name is distinct from old.full_name then
      v_details := v_details || jsonb_build_object(
        'full_name', jsonb_build_array(old.full_name, new.full_name)
      );
    end if;

    if (new.archived_at is not null) is distinct from (old.archived_at is not null) then
      v_details := v_details || jsonb_build_object(
        'archived', jsonb_build_array(old.archived_at is not null, new.archived_at is not null)
      );
    end if;

  else -- DELETE
    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := nullif(btrim(old.full_name), '');
    v_details := '{}'::jsonb;
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('contact', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_contact_activity$;

-- ============================================================================
-- 2b. log_person_activity(): same treatment.
-- ============================================================================

create or replace function public.log_person_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_person_activity$
declare
  v_actor_id uuid;
  v_actor_label text;
  v_entity_id uuid;
  v_action text;
  v_summary text;
  v_details jsonb;
  v_changed text[];
begin
  if tg_op = 'INSERT' then
    v_entity_id := new.id;
    v_action := 'created';
    v_summary := nullif(btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), '');
    v_details := '{}'::jsonb;

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new), array['updated_at', 'archived_at']);

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := nullif(btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), '');
    v_details := jsonb_build_object('fields', to_jsonb(v_changed));

    if new.first_name is distinct from old.first_name or new.last_name is distinct from old.last_name then
      v_details := v_details || jsonb_build_object(
        'full_name',
        jsonb_build_array(
          nullif(btrim(coalesce(old.first_name, '') || ' ' || coalesce(old.last_name, '')), ''),
          nullif(btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), '')
        )
      );
    end if;

    if (new.archived_at is not null) is distinct from (old.archived_at is not null) then
      v_details := v_details || jsonb_build_object(
        'archived', jsonb_build_array(old.archived_at is not null, new.archived_at is not null)
      );
    end if;

  else -- DELETE
    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := nullif(btrim(coalesce(old.first_name, '') || ' ' || coalesce(old.last_name, '')), '');
    v_details := '{}'::jsonb;
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('person', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_person_activity$;

-- ============================================================================
-- 3. Delete restricted to admins. App code already blocks the request
--    before it reaches the database when the entity is still linked to
--    a project (or, for a person, a receiver too) — this is the
--    database-level backstop for "admins only", not a replacement for
--    that check.
-- ============================================================================

drop policy if exists "contacts_delete_registered" on public.contacts;
drop policy if exists "contacts_delete_admin" on public.contacts;
create policy "contacts_delete_admin"
  on public.contacts for delete
  to authenticated
  using (public.is_registered_user() and public.is_admin());

drop policy if exists "people_delete_registered" on public.people;
drop policy if exists "people_delete_admin" on public.people;
create policy "people_delete_admin"
  on public.people for delete
  to authenticated
  using (public.is_registered_user() and public.is_admin());

commit;

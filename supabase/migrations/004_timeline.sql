-- ============================================================================
-- Migration 004: Project timeline (Phase 3)
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql,
-- 002_currency_check.sql and 003_contacts_upgrade.sql have already been
-- applied. Safe to re-run: every statement uses IF NOT EXISTS / CREATE OR
-- REPLACE / DROP ... IF EXISTS guards, except the one-time data delete in
-- step 3, which is itself idempotent (deleting zero rows the second time).
--
-- What this does
-- --------------
-- 1. Adds project_steps.done_at — the timestamp a next_step was checked
--    off, shown in the timeline's history as the completion date.
-- 2. project_steps already has RLS (4 policies) and a trigger that bumps
--    the parent project's last_activity_at (both added in
--    001_ark_schema.sql) — confirmed below, not re-added. It had NO
--    activity-log trigger yet (the table was schema-only until now); this
--    adds log_project_step_activity(), following the exact same shape as
--    log_project_document_activity().
-- 3. Removes the project side of notes: deletes any note rows that still
--    have a project_id (test data only — this app has two users and no
--    production history to preserve), then drops notes.project_id and
--    the now-vacuous "at most one link" check constraint (a note can
--    now link to at most a contact, which needs no such constraint).
-- ============================================================================


-- ============================================================================
-- 1. project_steps.done_at
-- ============================================================================

alter table public.project_steps
  add column if not exists done_at timestamptz;


-- ============================================================================
-- 2. Activity log for project_steps
--
-- Confirmed already in place from 001_ark_schema.sql, not touched here:
--   - RLS enabled with select/insert/update/delete policies gated on
--     is_registered_user() (project_steps_select_registered, etc.)
--   - touch_project_from_step() trigger bumping the parent project's
--     last_activity_at on every insert/update/delete.
--
-- Missing until now: nothing wrote to activity_log for this table. Same
-- shape and the same cascade guard as log_project_document_activity: a
-- DELETE whose parent project is already gone is the cascade from
-- deleting the project, not a timeline entry someone removed on purpose.
-- ============================================================================

alter table public.activity_log
  drop constraint if exists activity_log_entity_type_check;

alter table public.activity_log
  add constraint activity_log_entity_type_check
  check (entity_type in (
    'project', 'contact', 'project_document', 'contact_product', 'contact_document', 'project_step'
  ));

create or replace function public.log_project_step_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_project_step_activity$
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
    v_summary := new.body;
    v_details := jsonb_build_object(
      'parent_type', 'project',
      'parent_id', new.project_id,
      'kind', new.kind,
      'due_date', new.due_date
    );

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new));

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := new.body;
    v_details := jsonb_build_object(
      'parent_type', 'project',
      'parent_id', new.project_id,
      'kind', new.kind,
      'fields', to_jsonb(v_changed)
    );

    if new.done is distinct from old.done then
      v_details := v_details || jsonb_build_object('done', jsonb_build_array(old.done, new.done));
    end if;

  else -- DELETE
    if not exists (select 1 from public.projects p where p.id = old.project_id) then
      return null;
    end if;

    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := old.body;
    v_details := jsonb_build_object(
      'parent_type', 'project',
      'parent_id', old.project_id,
      'kind', old.kind
    );
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('project_step', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_project_step_activity$;

drop trigger if exists project_steps_log_activity on public.project_steps;
create trigger project_steps_log_activity
  after insert or update or delete on public.project_steps
  for each row
  execute function public.log_project_step_activity();

-- Same reasoning as every other trigger function's lock-down in
-- 001_ark_schema.sql / 003_contacts_upgrade.sql: revoke the PUBLIC
-- EXECUTE grant Postgres adds by default, so the anon key can't call
-- this directly as a PostgREST RPC. Trigger use is unaffected.
revoke all on function public.log_project_step_activity() from public, anon, authenticated;


-- ============================================================================
-- 3. notes: drop the project link
--
-- Projects now have their own timeline (project_steps) for anything that
-- used to live in a project-linked note. A note links to a contact or to
-- nothing at all.
-- ============================================================================

delete from public.notes where project_id is not null;

alter table public.notes
  drop constraint if exists notes_at_most_one_link;

drop index if exists public.notes_project_id_idx;

alter table public.notes
  drop column if exists project_id;

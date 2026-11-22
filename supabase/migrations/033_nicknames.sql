-- ============================================================================
-- Migration 033: Optional nicknames for receivers and projects
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 032_checklist_groups.sql have already been applied. Safe to
-- re-run — every statement uses ADD COLUMN IF NOT EXISTS, DROP
-- CONSTRAINT IF EXISTS before ADD, or CREATE OR REPLACE.
--
--   1. contacts.nickname / projects.nickname (text, nullable) — an
--      optional short name shown in place of the full name/full_name
--      throughout the app (lib/display-name.ts's displayName()).
--      Length-capped at 40 characters by a check constraint; trimming
--      itself is the app's job (every other free-text column in this
--      schema works the same way — see buildProjectPayload/
--      buildContactPayload), not enforced here. Nicknames are
--      deliberately NOT unique — a duplicate is only ever a warning
--      (lib/actions/nicknames.ts), never a save-time rejection.
--   2. log_project_activity() / log_contact_activity() are rebuilt to:
--      (a) use the nickname (falling back to the full name) as the
--      activity row's own `summary` — same "short name everywhere"
--      rule the app applies elsewhere, and (b) report a nickname
--      change as its own before/after pair in `details.nickname`,
--      the same treatment `details.full_name`/`details.name` (a
--      rename) already get, rather than leaving it to the generic
--      "fields changed" list.
--
-- No new activity_log entity_type is introduced by either change, so
-- activity_log_entity_type_check is untouched.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. contacts.nickname / projects.nickname
-- ----------------------------------------------------------------------------

alter table public.contacts
  add column if not exists nickname text;

alter table public.contacts
  drop constraint if exists contacts_nickname_length_check;

alter table public.contacts
  add constraint contacts_nickname_length_check
  check (nickname is null or char_length(nickname) <= 40);

alter table public.projects
  add column if not exists nickname text;

alter table public.projects
  drop constraint if exists projects_nickname_length_check;

alter table public.projects
  add constraint projects_nickname_length_check
  check (nickname is null or char_length(nickname) <= 40);

-- ----------------------------------------------------------------------------
-- 2. log_project_activity() — nickname as the row summary, and its own
--    change pair, same shape as 030_document_checklists.sql's version
--    plus both.
-- ----------------------------------------------------------------------------

create or replace function public.log_project_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_project_activity$
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
    v_summary := coalesce(nullif(btrim(new.nickname), ''), new.name);
    v_details := jsonb_build_object('stage', new.stage, 'final_product', new.final_product, 'priority', new.priority);

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(
      to_jsonb(old),
      to_jsonb(new),
      array['updated_at', 'last_activity_at']
    );

    -- Only bookkeeping columns moved: not worth a log row.
    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := coalesce(nullif(btrim(new.nickname), ''), new.name);
    v_details := jsonb_build_object('fields', to_jsonb(v_changed));

    if new.stage is distinct from old.stage then
      v_details := v_details || jsonb_build_object('stage', jsonb_build_array(old.stage, new.stage));
    end if;
    if new.status is distinct from old.status then
      v_details := v_details || jsonb_build_object('status', jsonb_build_array(old.status, new.status));
    end if;
    if new.priority is distinct from old.priority then
      v_details := v_details || jsonb_build_object('priority', jsonb_build_array(old.priority, new.priority));
    end if;
    if new.final_product is distinct from old.final_product then
      v_details := v_details || jsonb_build_object('final_product', jsonb_build_array(old.final_product, new.final_product));
    end if;
    if (new.archived_at is not null) is distinct from (old.archived_at is not null) then
      v_details := v_details || jsonb_build_object('archived', jsonb_build_array(old.archived_at is not null, new.archived_at is not null));
    end if;
    if new.is_recovery is distinct from old.is_recovery then
      v_details := v_details || jsonb_build_object('is_recovery', jsonb_build_array(old.is_recovery, new.is_recovery));
    end if;
    if new.nickname is distinct from old.nickname then
      v_details := v_details || jsonb_build_object('nickname', jsonb_build_array(old.nickname, new.nickname));
    end if;

    -- The one and only tell for "this was advance_project_stage_for_
    -- checklist() above, not a manual Stage-picker change" — set inside
    -- that same function, inside the same transaction as this UPDATE,
    -- so the trigger sees it; never set anywhere else, so an ordinary
    -- manual New → Documents Received pick still gets the plain
    -- stage-pair detail above instead of this wording.
    if v_changed = array['stage'] and old.stage = 'new' and new.stage = 'documents_received'
       and coalesce(current_setting('ark.auto_advance_checklist', true), '') = 'true' then
      v_summary := 'Stage → Documents received (checklist complete)';
    end if;

  else -- DELETE
    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := coalesce(nullif(btrim(old.nickname), ''), old.name);
    v_details := jsonb_build_object('stage', old.stage, 'final_product', old.final_product);
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('project', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_project_activity$;

-- ----------------------------------------------------------------------------
-- 3. log_contact_activity() — same treatment, full_name is this
--    table's equivalent of projects.name.
-- ----------------------------------------------------------------------------

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
    v_summary := coalesce(nullif(btrim(new.nickname), ''), nullif(btrim(new.full_name), ''));
    v_details := '{}'::jsonb;

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new), array['archived_at']);

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := coalesce(nullif(btrim(new.nickname), ''), nullif(btrim(new.full_name), ''));
    v_details := jsonb_build_object('fields', to_jsonb(v_changed));

    if new.full_name is distinct from old.full_name then
      v_details := v_details || jsonb_build_object(
        'full_name', jsonb_build_array(old.full_name, new.full_name)
      );
    end if;

    if new.nickname is distinct from old.nickname then
      v_details := v_details || jsonb_build_object(
        'nickname', jsonb_build_array(old.nickname, new.nickname)
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
    v_summary := coalesce(nullif(btrim(old.nickname), ''), nullif(btrim(old.full_name), ''));
    v_details := '{}'::jsonb;
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('contact', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_contact_activity$;

commit;

-- ============================================================================
-- Migration 023: Tranche confirmation + Active Tranches dashboard
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 022_telegram_inbox.sql have already been applied. Safe to
-- re-run — every statement uses IF EXISTS/IF NOT EXISTS, DROP ... IF
-- EXISTS before CREATE, or create or replace.
--
--   1. project_tranches.confirmed_on (date, nullable). A single check
--      constraint carries both rules at once: confirmed_on can only be
--      set alongside a sent_on, and never before it. That same
--      constraint is also what stops someone from clearing sent_on
--      while confirmed_on is still set — the app blocks it first with
--      a visible message, but the constraint is the real guarantee.
--   2. A new activity_log entity_type, 'project_tranche' — there was no
--      activity logging on project_tranches at all before this (only
--      touch_project_from_tranche, which just bumps the project's
--      last_activity_at). log_project_tranche_activity() is narrowly
--      scoped to confirmed_on specifically, per this feature's actual
--      ask ("Tranche 2 confirmed on …") — it does not log amount/
--      sent_on/notes edits or row creation/deletion, unlike every
--      other entity's trigger in this app, which logs everything.
--      activity_log_entity_type_check is rebuilt from the full current
--      list (001_ark_schema.sql through 022_telegram_inbox.sql) plus
--      this one new value.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. project_tranches.confirmed_on
-- ----------------------------------------------------------------------------

alter table public.project_tranches
  add column if not exists confirmed_on date;

alter table public.project_tranches
  drop constraint if exists project_tranches_confirmed_requires_sent;

alter table public.project_tranches
  add constraint project_tranches_confirmed_requires_sent
  check (confirmed_on is null or (sent_on is not null and confirmed_on >= sent_on));

-- ----------------------------------------------------------------------------
-- 2. activity_log: 'project_tranche' entity type + its trigger
-- ----------------------------------------------------------------------------

alter table public.activity_log
  drop constraint if exists activity_log_entity_type_check;

alter table public.activity_log
  add constraint activity_log_entity_type_check
  check (entity_type in (
    'project', 'contact', 'project_document', 'contact_product', 'contact_document',
    'project_step', 'backup', 'password_change', 'product', 'document_type', 'app_settings',
    'user', 'project_product', 'note', 'person', 'receiver_intermediary', 'project_intermediary',
    'status', 'project_tranche'
  ));

create or replace function public.log_project_tranche_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_project_tranche_activity$
declare
  v_actor_id uuid;
  v_actor_label text;
  v_summary text;
  v_details jsonb;
  v_old_confirmed_on date;
begin
  -- A brand-new row created with confirmed_on already set counts as a
  -- confirmation too (the app's tranche upsert can do this in one
  -- save — see components/projects/tranches-section.tsx) — INSERT is
  -- just UPDATE's "old confirmed_on" taken as null.
  if tg_op = 'INSERT' then
    if new.confirmed_on is null then
      return null;
    end if;
    v_old_confirmed_on := null;
  elsif tg_op = 'UPDATE' then
    if new.confirmed_on is not distinct from old.confirmed_on then
      return null;
    end if;
    v_old_confirmed_on := old.confirmed_on;
  else
    return null;
  end if;

  v_summary := case
    when new.confirmed_on is not null then
      'Tranche ' || new.tranche_number || ' confirmed on ' || to_char(new.confirmed_on, 'YYYY-MM-DD')
    else
      'Tranche ' || new.tranche_number || ' confirmation cleared'
  end;

  v_details := jsonb_build_object(
    'parent_type', 'project',
    'parent_id', new.project_id,
    'tranche_number', new.tranche_number,
    'confirmed_on', jsonb_build_array(v_old_confirmed_on, new.confirmed_on)
  );

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('project_tranche', new.id, 'updated', v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_project_tranche_activity$;

drop trigger if exists project_tranches_log_activity on public.project_tranches;
create trigger project_tranches_log_activity
  after insert or update on public.project_tranches
  for each row
  execute function public.log_project_tranche_activity();

revoke all on function public.log_project_tranche_activity() from public, anon, authenticated;

commit;

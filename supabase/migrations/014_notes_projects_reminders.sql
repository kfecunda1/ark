-- ============================================================================
-- Migration 014: Notes link to projects again; Dashboard reminders
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 013_projects_restructure.sql have already been applied.
--
-- Wrapped in BEGIN/COMMIT so the whole thing is all-or-nothing. Safe to
-- run more than once: every statement uses IF NOT EXISTS / CREATE OR
-- REPLACE / DROP ... IF EXISTS guards; the data migration (step 3) is
-- naturally idempotent too, since it deletes its own source rows as it
-- goes — a second run simply finds nothing left with kind = 'note' to
-- migrate.
--
-- Order (same lesson as 013_projects_restructure.sql's fix): constraint
-- changes, then columns, then the one-time data migration, then new
-- triggers — never the other way around, or a trigger created too
-- early either errors against a not-yet-widened constraint or floods
-- activity_log / resets last_activity_at for every migrated row.
--
--   1. Widen activity_log_entity_type_check to accept 'note'.
--   2. notes: re-add project_id (FK, on delete cascade, re-adding the
--      "at most one link" check alongside contact_id), add
--      reminder_done (reminded_at existed but was never actually read
--      or written by any app code — reminder_done is the real "has
--      this been dealt with" flag now).
--   3. Migrate every project_steps row with kind = 'note' into notes
--      (same text, author, created_at, project), then delete those
--      project_steps rows — before any new trigger on notes exists,
--      so this one-time move doesn't write one activity_log row per
--      migrated note, and doesn't reset last_activity_at on every
--      project that ever had one (see step 4's touch trigger).
--   4. Only now: notes' own triggers — log_note_activity (matching
--      every other entity's activity logging) and
--      touch_project_from_note (a project-linked note is as much
--      "project activity" as a step or a tranche, now that the
--      Timeline shows it alongside them).
--
-- project_steps.kind keeps 'note' as a technically legal enum value —
-- Postgres has no simple "drop one enum value" operation short of
-- rebuilding the whole type, which isn't worth it for a value the app
-- will simply never write again after this migration. There are zero
-- rows using it once step 3 finishes.
-- ============================================================================

begin;

-- ============================================================================
-- 1. Widen activity_log's entity_type check — first, before anything
--    later in this file can possibly write 'note'.
-- ============================================================================

alter table public.activity_log
  drop constraint if exists activity_log_entity_type_check;

alter table public.activity_log
  add constraint activity_log_entity_type_check
  check (entity_type in (
    'project', 'contact', 'project_document', 'contact_product', 'contact_document',
    'project_step', 'backup', 'password_change', 'product', 'document_type', 'app_settings',
    'user', 'project_product', 'note'
  ));


-- ============================================================================
-- 2. notes: project_id, and reminder_done
-- ============================================================================

alter table public.notes
  add column if not exists project_id uuid references public.projects (id) on delete cascade;

alter table public.notes
  drop constraint if exists notes_at_most_one_link;

alter table public.notes
  add constraint notes_at_most_one_link check (
    (case when project_id is not null then 1 else 0 end)
    + (case when contact_id is not null then 1 else 0 end)
    <= 1
  );

create index if not exists notes_project_id_idx on public.notes (project_id);

alter table public.notes
  add column if not exists reminder_done boolean not null default false;

-- reminded_at (001_ark_schema.sql) is left in place but still unused —
-- reminder_done is the column every query below actually reads/writes.
drop index if exists public.notes_reminders_idx;
create index if not exists notes_reminders_idx on public.notes (is_reminder, due_date, reminder_done);


-- ============================================================================
-- 3. Migrate project_steps (kind = 'note') into notes
-- ============================================================================

insert into public.notes (content, created_by, project_id, created_at)
select body, author_id, project_id, created_at
  from public.project_steps
 where kind = 'note';

delete from public.project_steps where kind = 'note';


-- ============================================================================
-- 4. notes' own triggers — created now, after the migration above, so
--    they only ever see future writes.
-- ============================================================================

-- Same shape as every other entity's activity logging (e.g.
-- log_contact_activity, 001_ark_schema.sql). A note's "parent" is a
-- project, a contact, or neither — parent_type/parent_id follow the
-- same convention project_document/contact_document use, just picked
-- dynamically here instead of being fixed per table. The DELETE
-- branch's cascade guard covers both possible parents: a note cascade-
-- deleted along with its project or its contact isn't "a note someone
-- removed on purpose".
create or replace function public.log_note_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_note_activity$
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
    v_summary := coalesce(nullif(btrim(new.title), ''), left(new.content, 80));
    v_details := jsonb_build_object(
      'parent_type', case when new.project_id is not null then 'project' when new.contact_id is not null then 'contact' else null end,
      'parent_id', coalesce(new.project_id, new.contact_id),
      'is_reminder', new.is_reminder
    );

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new));

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := coalesce(nullif(btrim(new.title), ''), left(new.content, 80));
    v_details := jsonb_build_object(
      'parent_type', case when new.project_id is not null then 'project' when new.contact_id is not null then 'contact' else null end,
      'parent_id', coalesce(new.project_id, new.contact_id),
      'fields', to_jsonb(v_changed)
    );

    if new.reminder_done is distinct from old.reminder_done then
      v_details := v_details || jsonb_build_object('reminder_done', jsonb_build_array(old.reminder_done, new.reminder_done));
    end if;

  else -- DELETE
    if old.project_id is not null and not exists (select 1 from public.projects p where p.id = old.project_id) then
      return null;
    end if;
    if old.contact_id is not null and not exists (select 1 from public.contacts c where c.id = old.contact_id) then
      return null;
    end if;

    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := coalesce(nullif(btrim(old.title), ''), left(old.content, 80));
    v_details := jsonb_build_object(
      'parent_type', case when old.project_id is not null then 'project' when old.contact_id is not null then 'contact' else null end,
      'parent_id', coalesce(old.project_id, old.contact_id)
    );
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('note', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_note_activity$;

drop trigger if exists notes_log_activity on public.notes;
create trigger notes_log_activity
  after insert or update or delete on public.notes
  for each row
  execute function public.log_note_activity();

-- Only bumps last_activity_at when the note is (or was) linked to a
-- project — a contact-linked or unlinked note isn't project activity.
create or replace function public.touch_project_from_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $touch_project_from_note$
begin
  if coalesce(new.project_id, old.project_id) is not null then
    update public.projects
       set last_activity_at = now()
     where id = coalesce(new.project_id, old.project_id);
  end if;
  return null;
end;
$touch_project_from_note$;

drop trigger if exists notes_touch_project on public.notes;
create trigger notes_touch_project
  after insert or update or delete on public.notes
  for each row
  execute function public.touch_project_from_note();

revoke all on function public.log_note_activity() from public, anon, authenticated;
revoke all on function public.touch_project_from_note() from public, anon, authenticated;

commit;

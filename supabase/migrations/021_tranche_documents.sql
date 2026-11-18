-- ============================================================================
-- Migration 021: Documents per tranche
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 020_media_uploads.sql have already been applied. Safe to
-- re-run — every statement uses IF EXISTS/IF NOT EXISTS, DROP ... IF
-- EXISTS before CREATE, or create or replace.
--
--   1. project_documents gets a nullable tranche_id, FK to
--      project_tranches(id) ON DELETE SET NULL — removing a tranche
--      moves its documents back to General (tranche_id null) instead
--      of deleting them. There's no declarative way to express "this
--      tranche must belong to the same project as this document" with
--      a plain FK, so a BEFORE INSERT/UPDATE trigger enforces that
--      cross-table check instead.
--   2. log_project_document_activity() (001_ark_schema.sql) is rebuilt
--      so a tranche_id-only change reads as "<file> moved to Tranche
--      N" / "<file> moved to General" instead of a generic "updated"
--      row — covers both an explicit "Move to…" action and the FK's
--      own ON DELETE SET NULL cascade when a tranche is removed. No
--      new activity_log entity_type is introduced (this is still a
--      'project_document' row), so activity_log_entity_type_check is
--      untouched.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. project_documents.tranche_id
-- ----------------------------------------------------------------------------

alter table public.project_documents
  add column if not exists tranche_id uuid references public.project_tranches (id) on delete set null;

create index if not exists project_documents_tranche_id_idx on public.project_documents (tranche_id);

create or replace function public.check_project_document_tranche()
returns trigger
language plpgsql
security definer
set search_path = public
as $check_project_document_tranche$
begin
  if new.tranche_id is not null and not exists (
    select 1 from public.project_tranches t
     where t.id = new.tranche_id
       and t.project_id = new.project_id
  ) then
    raise exception 'A document''s tranche must belong to its own project.';
  end if;
  return new;
end;
$check_project_document_tranche$;

drop trigger if exists project_documents_check_tranche on public.project_documents;
create trigger project_documents_check_tranche
  before insert or update on public.project_documents
  for each row
  execute function public.check_project_document_tranche();

revoke all on function public.check_project_document_tranche() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. log_project_document_activity(): describe a tranche move
-- ----------------------------------------------------------------------------

create or replace function public.log_project_document_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_project_document_activity$
declare
  v_actor_id uuid;
  v_actor_label text;
  v_entity_id uuid;
  v_action text;
  v_summary text;
  v_details jsonb;
  v_changed text[];
  v_tranche_number integer;
begin
  if tg_op = 'INSERT' then
    v_entity_id := new.id;
    v_action := 'created';
    v_summary := new.file_name;
    v_details := jsonb_build_object(
      'parent_type', 'project',
      'parent_id', new.project_id,
      'document_type', new.document_type,
      'tranche_id', new.tranche_id
    );

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new), array['file_hash']);

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := new.file_name;
    v_details := jsonb_build_object(
      'parent_type', 'project',
      'parent_id', new.project_id,
      'document_type', new.document_type,
      'fields', to_jsonb(v_changed)
    );

    -- A move (whether from the "Move to…" action or a tranche's own
    -- removal setting this null via the FK above) only ever touches
    -- tranche_id on its own — anything else changing alongside it
    -- falls back to the generic "updated" summary above.
    if v_changed = array['tranche_id'] and new.tranche_id is distinct from old.tranche_id then
      if new.tranche_id is null then
        v_summary := new.file_name || ' moved to General';
      else
        select tranche_number into v_tranche_number
          from public.project_tranches
         where id = new.tranche_id;
        v_summary := new.file_name || ' moved to Tranche ' || coalesce(v_tranche_number::text, '?');
      end if;
      v_details := v_details || jsonb_build_object('tranche_id', jsonb_build_array(old.tranche_id, new.tranche_id));
    end if;

  else -- DELETE
    if not exists (select 1 from public.projects p where p.id = old.project_id) then
      return null;
    end if;

    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := old.file_name;
    v_details := jsonb_build_object(
      'parent_type', 'project',
      'parent_id', old.project_id,
      'document_type', old.document_type,
      'tranche_id', old.tranche_id
    );
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('project_document', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_project_document_activity$;

-- Trigger itself already exists (created in 001_ark_schema.sql);
-- re-creating it here too just keeps this migration self-contained and
-- safe to re-run on its own.
drop trigger if exists project_documents_log_activity on public.project_documents;
create trigger project_documents_log_activity
  after insert or update or delete on public.project_documents
  for each row
  execute function public.log_project_document_activity();

revoke all on function public.log_project_document_activity() from public, anon, authenticated;

commit;

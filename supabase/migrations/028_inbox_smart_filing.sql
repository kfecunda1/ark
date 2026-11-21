-- ============================================================================
-- Inbox smart filing, bulk filing, and renaming documents.
--
-- No new tables/columns: smart suggestion and bulk filing are pure
-- app-logic over existing data, and renaming is just a file_name text
-- update everywhere it applies. The only DB change here is extending
-- the two existing document activity-log triggers (project_documents,
-- contact_documents) so a rename (file_name changed, nothing else)
-- reads as "Renamed <old> → <new>" instead of a generic "updated" row
-- — same pattern 021_tranche_documents.sql used for "moved to Tranche
-- N". inbox_items itself still has no activity-log trigger at all (by
-- design, see 022_telegram_inbox.sql) so a rename there is never
-- logged. No new activity_log entity_type is introduced, so
-- activity_log_entity_type_check is untouched.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. log_project_document_activity(): describe a rename, alongside the
--    existing tranche-move special case (021_tranche_documents.sql).
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

    -- A rename (the project/receiver Documents section's inline
    -- "Rename" action) only ever touches file_name on its own.
    if v_changed = array['file_name'] and new.file_name is distinct from old.file_name then
      v_summary := 'Renamed ' || old.file_name || ' → ' || new.file_name;
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

-- ----------------------------------------------------------------------------
-- 2. log_contact_document_activity(): same rename special case.
-- ----------------------------------------------------------------------------

create or replace function public.log_contact_document_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_contact_document_activity$
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
    v_summary := new.file_name;
    v_details := jsonb_build_object(
      'parent_type', 'contact',
      'parent_id', new.contact_id,
      'document_type', new.document_type
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
      'parent_type', 'contact',
      'parent_id', new.contact_id,
      'document_type', new.document_type,
      'fields', to_jsonb(v_changed)
    );

    -- A rename (the receiver Documents section's inline "Rename"
    -- action) only ever touches file_name on its own.
    if v_changed = array['file_name'] and new.file_name is distinct from old.file_name then
      v_summary := 'Renamed ' || old.file_name || ' → ' || new.file_name;
    end if;

  else -- DELETE
    if not exists (select 1 from public.contacts c where c.id = old.contact_id) then
      return null;
    end if;

    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := old.file_name;
    v_details := jsonb_build_object(
      'parent_type', 'contact',
      'parent_id', old.contact_id,
      'document_type', old.document_type
    );
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('contact_document', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_contact_document_activity$;

revoke all on function public.log_project_document_activity() from public, anon, authenticated;
revoke all on function public.log_contact_document_activity() from public, anon, authenticated;

commit;

-- ============================================================================
-- Migration 030: Document checklist per product
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 029_morning_briefing.sql have already been applied. Safe to
-- re-run — every statement uses IF EXISTS/IF NOT EXISTS, DROP ... IF
-- EXISTS before CREATE, or CREATE OR REPLACE.
--
--   1. product_required_documents — admin-managed (product,
--      document_type) pairs (Settings → Document checklists); a
--      project's checklist is the union of this table's rows for its
--      final product (once decided) or every one of its product
--      options (lib/checklists.ts computes this, nothing new to query
--      beyond this table + project_documents). Both FKs reference
--      products/document_types by their unique `name`, ON UPDATE
--      CASCADE, same shape project_products.product/project_documents.
--      document_type already use — renaming a product or document
--      type elsewhere keeps a requirement attached instead of orphaning
--      it. RLS: any registered user can read it (the Project page's own
--      checklist panel needs it); only an admin can write.
--   2. app_settings.auto_advance_on_documents (boolean, default true) —
--      Settings → Document checklists' own toggle. log_app_settings_
--      activity() (024_show_recovery.sql) is rebuilt to also report a
--      change to it, same treatment as show_recovery.
--   3. advance_project_stage_for_checklist(project_id) — a narrow,
--      hardcoded New → Documents Received transition (never any other
--      pair), called by the app once a project's checklist goes
--      complete after an upload/inbox filing/rename (lib/checklists.ts's
--      maybeAutoAdvanceStage). Sets a transaction-local flag
--      (ark.auto_advance_checklist) purely so log_project_activity()
--      (001_ark_schema.sql, last redefined by 015_recovery.sql) can tell
--      this specific stage change apart from an ordinary manual one made
--      through the Stage picker — only then does it summarize the row
--      as "Stage → Documents received (checklist complete)" instead of
--      the generic one. The WHERE stage = 'new' guard makes a second,
--      racing call a no-op (affects zero rows, trigger never fires
--      twice) and is also what guarantees this can only ever move a
--      project forward, never backwards and never past Documents
--      Received. No new activity_log entity_type is introduced by any
--      of this, so activity_log_entity_type_check is untouched.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. product_required_documents
-- ----------------------------------------------------------------------------

create table if not exists public.product_required_documents (
  id uuid primary key default gen_random_uuid(),
  product text not null references public.products (name) on update cascade,
  document_type text not null references public.document_types (name) on update cascade,
  created_at timestamptz not null default now(),
  unique (product, document_type)
);

alter table public.product_required_documents enable row level security;

drop policy if exists "product_required_documents_select_registered" on public.product_required_documents;
create policy "product_required_documents_select_registered"
  on public.product_required_documents for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "product_required_documents_insert_admin" on public.product_required_documents;
create policy "product_required_documents_insert_admin"
  on public.product_required_documents for insert
  to authenticated
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "product_required_documents_update_admin" on public.product_required_documents;
create policy "product_required_documents_update_admin"
  on public.product_required_documents for update
  to authenticated
  using (public.is_registered_user() and public.is_admin())
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "product_required_documents_delete_admin" on public.product_required_documents;
create policy "product_required_documents_delete_admin"
  on public.product_required_documents for delete
  to authenticated
  using (public.is_registered_user() and public.is_admin());

-- ----------------------------------------------------------------------------
-- 2. app_settings.auto_advance_on_documents
-- ----------------------------------------------------------------------------

alter table public.app_settings
  add column if not exists auto_advance_on_documents boolean not null default true;

create or replace function public.log_app_settings_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_app_settings_activity$
declare
  v_actor_id uuid;
  v_actor_label text;
  v_action text;
  v_details jsonb;
  v_changed text[];
  v_entity_id constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  if tg_op = 'INSERT' then
    v_action := 'created';
    v_details := jsonb_build_object(
      'default_currency', new.default_currency,
      'stuck_after_days', new.stuck_after_days
    );

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new), array['updated_at']);

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_action := 'updated';
    v_details := jsonb_build_object('fields', to_jsonb(v_changed));

    if new.default_currency is distinct from old.default_currency then
      v_details := v_details || jsonb_build_object(
        'default_currency', jsonb_build_array(old.default_currency, new.default_currency)
      );
    end if;
    if new.stuck_after_days is distinct from old.stuck_after_days then
      v_details := v_details || jsonb_build_object(
        'stuck_after_days', jsonb_build_array(old.stuck_after_days, new.stuck_after_days)
      );
    end if;
    if new.show_recovery is distinct from old.show_recovery then
      v_details := v_details || jsonb_build_object(
        'show_recovery', jsonb_build_array(old.show_recovery, new.show_recovery)
      );
    end if;
    if new.auto_advance_on_documents is distinct from old.auto_advance_on_documents then
      v_details := v_details || jsonb_build_object(
        'auto_advance_on_documents', jsonb_build_array(old.auto_advance_on_documents, new.auto_advance_on_documents)
      );
    end if;

  else -- DELETE: never happens (no DELETE policy, singleton row), guarded anyway
    v_action := 'deleted';
    v_details := '{}'::jsonb;
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('app_settings', v_entity_id, v_action, 'Settings', v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_app_settings_activity$;

-- ----------------------------------------------------------------------------
-- 3. advance_project_stage_for_checklist() + log_project_activity()'s
--    special-cased summary for it.
-- ----------------------------------------------------------------------------

create or replace function public.advance_project_stage_for_checklist(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $advance_project_stage_for_checklist$
begin
  if not public.is_registered_user() then
    raise exception 'Not authorized';
  end if;

  perform set_config('ark.auto_advance_checklist', 'true', true);

  update public.projects
     set stage = 'documents_received'
   where id = p_project_id
     and stage = 'new';
end;
$advance_project_stage_for_checklist$;

revoke all on function public.advance_project_stage_for_checklist(uuid) from public, anon, authenticated;
grant execute on function public.advance_project_stage_for_checklist(uuid) to authenticated;

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
    v_summary := new.name;
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
    v_summary := new.name;
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
    v_summary := old.name;
    v_details := jsonb_build_object('stage', old.stage, 'final_product', old.final_product);
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('project', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_project_activity$;

commit;

-- ============================================================================
-- Migration 015: Recovery projects
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 014_notes_projects_reminders.sql have already been applied.
--
-- Wrapped in BEGIN/COMMIT so the whole thing is all-or-nothing. Safe to
-- run more than once: every statement uses IF NOT EXISTS / CREATE OR
-- REPLACE guards.
--
-- Both new columns default safely for existing rows (false / null), so
-- unlike 013/014 there's no data migration step and no ordering hazard
-- around activity_log triggers — log_project_activity() is simply
-- redefined (CREATE OR REPLACE, same trigger already attached since
-- 001_ark_schema.sql) to also report is_recovery changes, and
-- log_contact_product_activity() (003_contacts_upgrade.sql) already
-- reports *any* changed column generically via its `fields` array, so
-- recovery_ratio needs no trigger change at all.
--
--   1. projects.is_recovery boolean, default false.
--   2. contact_products.recovery_ratio text, nullable (parallel to the
--      existing `ratio` column, just for the recovery case).
--   3. Redefine log_project_activity() to report is_recovery changes.
-- ============================================================================

begin;

-- ============================================================================
-- 1. projects.is_recovery
-- ============================================================================

alter table public.projects
  add column if not exists is_recovery boolean not null default false;

-- ============================================================================
-- 2. contact_products.recovery_ratio
-- ============================================================================

alter table public.contact_products
  add column if not exists recovery_ratio text;

-- ============================================================================
-- 3. log_project_activity(): report is_recovery changes, same "before/
--    after pair" treatment as stage/status/priority/final_product/
--    archived already get. CREATE OR REPLACE keeps it attached to the
--    existing projects_log_activity trigger without recreating it.
-- ============================================================================

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

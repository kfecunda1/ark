-- ============================================================================
-- Migration 024: Recovery on/off switch
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 023_tranche_confirmed.sql have already been applied. Safe to
-- re-run — every statement uses IF EXISTS/IF NOT EXISTS, DROP ... IF
-- EXISTS before CREATE, or create or replace.
--
--   app_settings.show_recovery (boolean, default true) — Settings →
--   Defaults' "Show Recovery" toggle. Off hides recovery features
--   throughout the app (the Recovery Projects dashboard card and
--   sidebar tab, the Recovery checkbox on project forms/detail pages,
--   and every Recovery badge); recovery projects themselves, and all
--   their data, are completely untouched either way — this is purely
--   a display switch, nothing here filters or deletes a row. No new
--   activity_log entity_type is needed (app_settings already has one);
--   log_app_settings_activity() is rebuilt to also describe a
--   show_recovery change, the same way it already does for
--   default_currency/stuck_after_days.
-- ============================================================================

begin;

alter table public.app_settings
  add column if not exists show_recovery boolean not null default true;

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

commit;

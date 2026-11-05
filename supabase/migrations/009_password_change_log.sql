-- ============================================================================
-- Migration 009: Password change logging
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 008_add_gpi.sql have already been applied. Safe to re-run:
-- CREATE OR REPLACE / DROP ... IF EXISTS guards throughout.
--
-- No schema change was asked for by name, but one is required to
-- satisfy "write an activity-log entry": activity_log is append-only by
-- design (001_ark_schema.sql) — it has a SELECT policy only, no INSERT
-- policy at all, so a plain `insert into activity_log` from the browser
-- would be rejected by RLS. This adds one narrow, purpose-built
-- function the Settings page's Change Password form calls via
-- supabase.rpc() right after supabase.auth.updateUser() succeeds —
-- same pattern as 007_backup_log.sql's log_backup_export(), except
-- every registered user may call this one (changing your own password
-- needs no admin role), and it never receives or logs the password
-- itself — only the fact that a change happened, and who did it.
-- ============================================================================

alter table public.activity_log
  drop constraint if exists activity_log_entity_type_check;

alter table public.activity_log
  add constraint activity_log_entity_type_check
  check (entity_type in (
    'project', 'contact', 'project_document', 'contact_product', 'contact_document',
    'project_step', 'backup', 'password_change'
  ));

create or replace function public.log_password_change()
returns void
language plpgsql
security definer
set search_path = public
as $log_password_change$
declare
  v_actor_id uuid;
  v_actor_label text;
begin
  if not public.is_registered_user() then
    raise exception 'Not authorized';
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values (
    'password_change',
    coalesce(v_actor_id, gen_random_uuid()),
    'updated',
    'Password changed by ' || coalesce(v_actor_label, 'Unknown user'),
    '{}'::jsonb,
    v_actor_id,
    v_actor_label
  );
end;
$log_password_change$;

-- Unlike every trigger-only function in this schema (EXECUTE revoked
-- from everyone), this one is meant to be called directly by the
-- client, so it's granted EXECUTE on `authenticated` — but it only ever
-- inserts a fixed, actor-derived row, so there's nothing a caller can
-- forge beyond "I changed my own password just now."
revoke all on function public.log_password_change() from public, anon, authenticated;
grant execute on function public.log_password_change() to authenticated;

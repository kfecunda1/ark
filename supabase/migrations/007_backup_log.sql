-- ============================================================================
-- Migration 007: Backup export logging
--
-- Run this manually in the Supabase SQL editor, after 006_admin_role.sql
-- has already been applied. Safe to re-run: CREATE OR REPLACE / DROP ...
-- IF EXISTS guards throughout.
--
-- Not explicitly asked for by name, but required to satisfy "log each
-- export in the activity log": activity_log is append-only by design
-- (001_ark_schema.sql) — it has a SELECT policy only, no INSERT policy
-- at all, so a plain `insert into activity_log` from the browser would
-- be rejected by RLS. This adds one narrow, purpose-built function the
-- Settings page's Export button calls via supabase.rpc(), instead of
-- opening up INSERT on the table itself.
--
-- Unlike every other trigger function in this schema (which get EXECUTE
-- revoked from everyone because they're only ever invoked by a trigger),
-- this one is meant to be called directly by the client — so it's
-- granted EXECUTE on `authenticated`, and enforces the admin-only rule
-- itself (checking the caller's own profiles.role) rather than relying
-- on the Settings page merely hiding the button from non-admins.
-- ============================================================================

alter table public.activity_log
  drop constraint if exists activity_log_entity_type_check;

alter table public.activity_log
  add constraint activity_log_entity_type_check
  check (entity_type in (
    'project', 'contact', 'project_document', 'contact_product', 'contact_document',
    'project_step', 'backup'
  ));

create or replace function public.log_backup_export()
returns void
language plpgsql
security definer
set search_path = public
as $log_backup_export$
declare
  v_role text;
  v_actor_id uuid;
  v_actor_label text;
begin
  select role into v_role from public.profiles where id = auth.uid();

  if v_role is distinct from 'admin' then
    raise exception 'Only admins can export a backup.';
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values (
    'backup',
    coalesce(v_actor_id, gen_random_uuid()),
    'created',
    'Backup exported by ' || coalesce(v_actor_label, 'Unknown user'),
    '{}'::jsonb,
    v_actor_id,
    v_actor_label
  );
end;
$log_backup_export$;

revoke all on function public.log_backup_export() from public, anon, authenticated;
grant execute on function public.log_backup_export() to authenticated;

-- ============================================================================
-- Migration 019: Statuses — admin-managed, same pattern as Products
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 018_intermediaries.sql have already been applied. Mostly safe
-- to re-run (CREATE OR REPLACE / DROP ... IF EXISTS / ON CONFLICT
-- guards throughout) — the one exception is the enum-to-text column
-- conversion in section 3, which becomes a no-op the second time (the
-- column is already text by then, and `text::text` is a valid cast),
-- and the `drop type` statement there, which uses IF EXISTS.
--
-- Order (per the request): constraint changes -> tables -> data
-- migration -> triggers.
--
--   1. Widen activity_log_entity_type_check to accept 'status' — the
--      full current list below was read directly out of
--      018_intermediaries.sql (the migration that most recently
--      rewrote it), not retyped from memory, so this adds to it rather
--      than risking silently dropping an entity type some later
--      migration added.
--   2. statuses table — admin-managed, same shape as products/
--      document_types (011_settings_tables.sql) plus two columns those
--      don't need: `kind` ('open'/'completed'/'lost' — what the
--      dashboard and every other "is this project closed?" check now
--      reads instead of a hard-coded status name) and `color` (one of
--      a fixed ~8-value palette, so an admin picks a look rather than
--      typing a Tailwind class). Seeded in the current order with the
--      current labels.
--   3. projects.status: enum -> text + FK to statuses(name) ON UPDATE
--      CASCADE, migrating every existing value to its new display-
--      label form (e.g. with_receiver -> 'With Receiver') before the
--      FK is added (the FK would reject the old slugs otherwise). The
--      "status required once stage = status" check constraint
--      (projects_status_required_when_stage_status) only tests
--      nullity, never the enum type itself, so it carries over
--      untouched. Confirmed via grep across every migration file that
--      nothing else — no function, no trigger, no other cast —
--      depends on the project_status enum, so it's safe to drop once
--      the column no longer uses it.
--   4. Triggers: set_updated_at_only (reused from 003_contacts_
--      upgrade.sql) and log_status_activity, the same shape as
--      log_product_activity (011_settings_tables.sql).
-- ============================================================================

begin;

-- ============================================================================
-- 1. Widen activity_log's entity_type check.
-- ============================================================================

alter table public.activity_log
  drop constraint if exists activity_log_entity_type_check;

alter table public.activity_log
  add constraint activity_log_entity_type_check
  check (entity_type in (
    'project', 'contact', 'project_document', 'contact_product', 'contact_document',
    'project_step', 'backup', 'password_change', 'product', 'document_type', 'app_settings',
    'user', 'project_product', 'note', 'person', 'receiver_intermediary', 'project_intermediary',
    'status'
  ));

-- ============================================================================
-- 2. statuses
-- ============================================================================

create table if not exists public.statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('open', 'completed', 'lost')),
  color text not null check (color in (
    'accent', 'cyan', 'teal', 'silver', 'sky', 'emerald', 'amber', 'rose'
  )),
  active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.statuses enable row level security;

insert into public.statuses (name, kind, color, sort_order) values
  ('Open', 'open', 'accent', 1),
  ('With Receiver', 'open', 'cyan', 2),
  ('With Sender', 'open', 'teal', 3),
  ('Waiting', 'open', 'silver', 4),
  ('In Process', 'open', 'sky', 5),
  ('Completed', 'completed', 'emerald', 6),
  ('Lost', 'lost', 'rose', 7)
on conflict (name) do nothing;

-- Registered users read; only admins write. No DELETE policy at all —
-- same "hide, never delete" rule as products/document_types: a status
-- still referenced by a project must keep displaying and filtering
-- correctly, so it's only ever hidden (active = false), never removed.
drop policy if exists "statuses_select_registered" on public.statuses;
create policy "statuses_select_registered"
  on public.statuses for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "statuses_insert_admin" on public.statuses;
create policy "statuses_insert_admin"
  on public.statuses for insert
  to authenticated
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "statuses_update_admin" on public.statuses;
create policy "statuses_update_admin"
  on public.statuses for update
  to authenticated
  using (public.is_registered_user() and public.is_admin())
  with check (public.is_registered_user() and public.is_admin());

-- ============================================================================
-- 3. projects.status: enum -> text + FK to statuses(name) ON UPDATE
--    CASCADE. The data migration (mapping old slugs to their new
--    display-label text) must run *before* the FK is added — the FK
--    would otherwise reject every existing row still holding a slug
--    that isn't a name in `statuses`.
-- ============================================================================

alter table public.projects
  alter column status type text using status::text;

update public.projects set status = 'Open' where status = 'open';
update public.projects set status = 'With Receiver' where status = 'with_receiver';
update public.projects set status = 'With Sender' where status = 'with_sender';
update public.projects set status = 'Waiting' where status = 'waiting';
update public.projects set status = 'In Process' where status = 'in_process';
update public.projects set status = 'Completed' where status = 'completed';
update public.projects set status = 'Lost' where status = 'lost';

alter table public.projects
  drop constraint if exists projects_status_fkey;

alter table public.projects
  add constraint projects_status_fkey
  foreign key (status) references public.statuses (name)
  on update cascade;

-- projects_status_required_when_stage_status (001_ark_schema.sql) only
-- tests `status is not null` — never the enum type — so it's left
-- untouched; it already applies correctly to the now-text column.

drop type if exists public.project_status;

-- ============================================================================
-- 4. Triggers: updated_at + activity log.
-- ============================================================================

drop trigger if exists statuses_set_updated_at on public.statuses;
create trigger statuses_set_updated_at
  before update on public.statuses
  for each row
  execute function public.set_updated_at_only();

create or replace function public.log_status_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_status_activity$
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
    v_details := jsonb_build_object('active', new.active, 'sort_order', new.sort_order, 'kind', new.kind, 'color', new.color);

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new), array['updated_at']);

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := new.name;
    v_details := jsonb_build_object('fields', to_jsonb(v_changed));

    if new.name is distinct from old.name then
      v_details := v_details || jsonb_build_object('name', jsonb_build_array(old.name, new.name));
    end if;
    if new.active is distinct from old.active then
      v_details := v_details || jsonb_build_object('active', jsonb_build_array(old.active, new.active));
    end if;

  else -- DELETE (no policy grants this via the app; guarded for completeness)
    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := old.name;
    v_details := '{}'::jsonb;
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('status', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_status_activity$;

drop trigger if exists statuses_log_activity on public.statuses;
create trigger statuses_log_activity
  after insert or update or delete on public.statuses
  for each row
  execute function public.log_status_activity();

revoke all on function public.log_status_activity() from public, anon, authenticated;

commit;

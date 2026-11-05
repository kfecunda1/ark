-- ============================================================================
-- Migration 016: Receivers (UI rename only) + People ("Contacts" tab)
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 015_recovery.sql have already been applied.
--
-- Wrapped in BEGIN/COMMIT so the whole thing is all-or-nothing. Safe to
-- run more than once: every statement uses IF NOT EXISTS / CREATE OR
-- REPLACE guards.
--
-- IMPORTANT: "Contacts" becoming "Receivers" is a UI-only rename (see
-- AGENTS.md's "UI naming vs database naming" section). This migration
-- does NOT rename the `contacts` table, its columns, the
-- "contact-documents" storage bucket, or any `contact_*` identifier —
-- only adds new things:
--
--   1. Widen activity_log_entity_type_check to accept 'person' —
--      first, before the people table (and its activity trigger)
--      below can possibly write one.
--   2. The new `people` table (the real "Contacts" tab) — first_name/
--      last_name/phone/email, RLS policies mirroring `contacts`
--      exactly, its own updated_at trigger (reusing set_updated_at_only
--      from 003_contacts_upgrade.sql — same function `contact_products`
--      already uses, since `people` has updated_at but no
--      last_activity_at either), and its own activity-log trigger.
--   3. contacts.contact_person_id and projects.contact_person_id — an
--      optional link from a Receiver, or from a Project, to one
--      `people` row. ON DELETE SET NULL: deleting a person should
--      never take a Receiver or Project down with it.
--
-- No data migration step: `people` starts empty and both new FK
-- columns are nullable, so there's nothing to backfill and no ordering
-- hazard around activity_log — unlike 013/014, which had to move
-- existing rows before their new triggers could exist.
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
    'user', 'project_product', 'note', 'person'
  ));

-- ============================================================================
-- 2. people — the "Contacts" tab's own table. Named `people` (not
--    `contacts`) specifically so it can never collide with the
--    existing `contacts` table (UI: Receivers) this migration leaves
--    untouched.
-- ============================================================================

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.people enable row level security;

drop policy if exists "people_select_registered" on public.people;
create policy "people_select_registered"
  on public.people for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "people_insert_registered" on public.people;
create policy "people_insert_registered"
  on public.people for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "people_update_registered" on public.people;
create policy "people_update_registered"
  on public.people for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "people_delete_registered" on public.people;
create policy "people_delete_registered"
  on public.people for delete
  to authenticated
  using (public.is_registered_user());

-- set_updated_at_only() (003_contacts_upgrade.sql) — people has
-- updated_at but no last_activity_at, same reasoning as
-- contact_products there.
drop trigger if exists people_set_updated_at on public.people;
create trigger people_set_updated_at
  before update on public.people
  for each row
  execute function public.set_updated_at_only();

-- Same shape as log_contact_activity (001_ark_schema.sql), summary
-- built from first_name + last_name instead of a single full_name.
create or replace function public.log_person_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_person_activity$
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
    v_summary := nullif(btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), '');
    v_details := '{}'::jsonb;

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new), array['updated_at']);

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := nullif(btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), '');
    v_details := jsonb_build_object('fields', to_jsonb(v_changed));

    if new.first_name is distinct from old.first_name or new.last_name is distinct from old.last_name then
      v_details := v_details || jsonb_build_object(
        'full_name',
        jsonb_build_array(
          nullif(btrim(coalesce(old.first_name, '') || ' ' || coalesce(old.last_name, '')), ''),
          nullif(btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), '')
        )
      );
    end if;

  else -- DELETE
    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := nullif(btrim(coalesce(old.first_name, '') || ' ' || coalesce(old.last_name, '')), '');
    v_details := '{}'::jsonb;
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('person', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_person_activity$;

drop trigger if exists people_log_activity on public.people;
create trigger people_log_activity
  after insert or update or delete on public.people
  for each row
  execute function public.log_person_activity();

revoke all on function public.log_person_activity() from public, anon, authenticated;

-- ============================================================================
-- 3. Optional "contact person" link — Receivers and Projects can each
--    point at one person. ON DELETE SET NULL: removing a person is
--    never blocked by, and never cascades into, a Receiver or Project.
-- ============================================================================

alter table public.contacts
  add column if not exists contact_person_id uuid references public.people (id) on delete set null;

create index if not exists contacts_contact_person_id_idx on public.contacts (contact_person_id);

alter table public.projects
  add column if not exists contact_person_id uuid references public.people (id) on delete set null;

create index if not exists projects_contact_person_id_idx on public.projects (contact_person_id);

commit;

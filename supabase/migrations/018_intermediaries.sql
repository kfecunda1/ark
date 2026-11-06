-- ============================================================================
-- Migration 018: Intermediaries
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 017_archive_receivers_people.sql have already been applied.
--
-- Wrapped in BEGIN/COMMIT so the whole thing is all-or-nothing. Safe to
-- run more than once: every statement uses IF NOT EXISTS / CREATE OR
-- REPLACE / DROP ... IF EXISTS guards.
--
-- Order (per the request): constraint changes -> tables -> triggers —
-- same reasoning as every migration since 013_projects_restructure.sql:
-- the activity_log check constraint must accept the new entity types
-- before anything below can possibly write one.
--
--   1. Widen activity_log_entity_type_check to accept
--      'receiver_intermediary' and 'project_intermediary'.
--   2. receiver_intermediaries — which `people` are an intermediary for
--      a given Receiver (contacts row). Unordered: a receiver's
--      intermediaries are just a set (shown on the Receiver page with
--      how many of its projects each one appears in), unlike a
--      project's own chain below.
--   3. project_intermediaries — a project's ordered intermediary chain
--      ("Name -> Name -> <Receiver>"), 1-based `position` per project.
--      Both tables' person_id is ON DELETE RESTRICT, deliberately
--      unlike contacts.contact_person_id / projects.contact_person_id
--      (ON DELETE SET NULL): an intermediary link *is* the point of the
--      row, so deleting that person must be blocked, not silently drop
--      the link. lib/actions/people.ts's deletePerson already checks
--      for this and returns a friendly error before the request ever
--      reaches the database — this is the same belt-and-suspenders
--      backstop contacts_delete_admin / people_delete_admin (017) are
--      for "admin-only": the real enforcement, not just the UI.
--   4. Triggers: touch_project_from_intermediary (bumps a project's
--      last_activity_at, same as every other project child table) and
--      the two activity-log triggers. Reordering a project's chain
--      (app-side: a 3-step "move the row being displaced out of the
--      way first" dance, so a plain UNIQUE (project_id, position) never
--      sees a transient duplicate) is the only UPDATE either table ever
--      gets — receiver_intermediaries rows are only ever inserted or
--      deleted.
--
-- No data migration step: both tables start empty.
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
    'user', 'project_product', 'note', 'person', 'receiver_intermediary', 'project_intermediary'
  ));

-- ============================================================================
-- 2. receiver_intermediaries
-- ============================================================================

create table if not exists public.receiver_intermediaries (
  id uuid primary key default gen_random_uuid(),
  receiver_id uuid not null references public.contacts (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (receiver_id, person_id)
);

create index if not exists receiver_intermediaries_receiver_id_idx on public.receiver_intermediaries (receiver_id);
create index if not exists receiver_intermediaries_person_id_idx on public.receiver_intermediaries (person_id);

alter table public.receiver_intermediaries enable row level security;

drop policy if exists "receiver_intermediaries_select_registered" on public.receiver_intermediaries;
create policy "receiver_intermediaries_select_registered"
  on public.receiver_intermediaries for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "receiver_intermediaries_insert_registered" on public.receiver_intermediaries;
create policy "receiver_intermediaries_insert_registered"
  on public.receiver_intermediaries for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "receiver_intermediaries_update_registered" on public.receiver_intermediaries;
create policy "receiver_intermediaries_update_registered"
  on public.receiver_intermediaries for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "receiver_intermediaries_delete_registered" on public.receiver_intermediaries;
create policy "receiver_intermediaries_delete_registered"
  on public.receiver_intermediaries for delete
  to authenticated
  using (public.is_registered_user());

-- ============================================================================
-- 3. project_intermediaries
-- ============================================================================

create table if not exists public.project_intermediaries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete restrict,
  position integer not null,
  created_at timestamptz not null default now(),
  unique (project_id, person_id),
  unique (project_id, position)
);

create index if not exists project_intermediaries_project_id_idx on public.project_intermediaries (project_id);
create index if not exists project_intermediaries_person_id_idx on public.project_intermediaries (person_id);

alter table public.project_intermediaries enable row level security;

drop policy if exists "project_intermediaries_select_registered" on public.project_intermediaries;
create policy "project_intermediaries_select_registered"
  on public.project_intermediaries for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "project_intermediaries_insert_registered" on public.project_intermediaries;
create policy "project_intermediaries_insert_registered"
  on public.project_intermediaries for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "project_intermediaries_update_registered" on public.project_intermediaries;
create policy "project_intermediaries_update_registered"
  on public.project_intermediaries for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "project_intermediaries_delete_registered" on public.project_intermediaries;
create policy "project_intermediaries_delete_registered"
  on public.project_intermediaries for delete
  to authenticated
  using (public.is_registered_user());

-- ============================================================================
-- 4a. touch_project_from_intermediary — same reasoning as
--     touch_project_from_product (013_projects_restructure.sql):
--     changing a project's intermediary chain is real project activity.
--     receiver_intermediaries gets no equivalent — contacts (Receivers)
--     has no last_activity_at column at all (003_contacts_upgrade.sql).
-- ============================================================================

create or replace function public.touch_project_from_intermediary()
returns trigger
language plpgsql
security definer
set search_path = public
as $touch_project_from_intermediary$
begin
  update public.projects
     set last_activity_at = now()
   where id = coalesce(new.project_id, old.project_id);
  return null;
end;
$touch_project_from_intermediary$;

drop trigger if exists project_intermediaries_touch_project on public.project_intermediaries;
create trigger project_intermediaries_touch_project
  after insert or update or delete on public.project_intermediaries
  for each row
  execute function public.touch_project_from_intermediary();

-- ============================================================================
-- 4b. Activity log — receiver_intermediaries. Summary is the linked
--     person's name (a lookup — person_id alone means nothing in the
--     Activity page's list). Same "deleted row's parent might already
--     be gone" cascade guard as log_contact_product_activity
--     (003_contacts_upgrade.sql): a DELETE whose receiver no longer
--     exists is the cascade from deleting that receiver, not someone
--     removing an intermediary on purpose.
-- ============================================================================

create or replace function public.log_receiver_intermediary_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_receiver_intermediary_activity$
declare
  v_actor_id uuid;
  v_actor_label text;
  v_entity_id uuid;
  v_action text;
  v_summary text;
  v_details jsonb;
begin
  if tg_op = 'INSERT' then
    v_entity_id := new.id;
    v_action := 'created';
    v_details := jsonb_build_object('parent_type', 'contact', 'parent_id', new.receiver_id, 'person_id', new.person_id);

    select nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
      into v_summary
      from public.people p where p.id = new.person_id;

  else -- DELETE (no UPDATE path — a row is only ever added or removed)
    if not exists (select 1 from public.contacts c where c.id = old.receiver_id) then
      return null;
    end if;

    v_entity_id := old.id;
    v_action := 'deleted';
    v_details := jsonb_build_object('parent_type', 'contact', 'parent_id', old.receiver_id, 'person_id', old.person_id);

    select nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
      into v_summary
      from public.people p where p.id = old.person_id;
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('receiver_intermediary', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_receiver_intermediary_activity$;

drop trigger if exists receiver_intermediaries_log_activity on public.receiver_intermediaries;
create trigger receiver_intermediaries_log_activity
  after insert or delete on public.receiver_intermediaries
  for each row
  execute function public.log_receiver_intermediary_activity();

-- ============================================================================
-- 4c. Activity log — project_intermediaries. The only UPDATE this table
--     ever gets is a reorder (position changing) — logged as that
--     position change specifically, not a generic "fields changed"
--     chip; any other "UPDATE" (none fired by the app) is ignored.
-- ============================================================================

create or replace function public.log_project_intermediary_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_project_intermediary_activity$
declare
  v_actor_id uuid;
  v_actor_label text;
  v_entity_id uuid;
  v_action text;
  v_summary text;
  v_details jsonb;
begin
  if tg_op = 'INSERT' then
    v_entity_id := new.id;
    v_action := 'created';
    v_details := jsonb_build_object(
      'parent_type', 'project', 'parent_id', new.project_id,
      'person_id', new.person_id, 'position', new.position
    );

    select nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
      into v_summary
      from public.people p where p.id = new.person_id;

  elsif tg_op = 'UPDATE' then
    if new.position is distinct from old.position then
      v_entity_id := new.id;
      v_action := 'updated';
      v_details := jsonb_build_object(
        'parent_type', 'project', 'parent_id', new.project_id,
        'person_id', new.person_id, 'position', jsonb_build_array(old.position, new.position)
      );

      select nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
        into v_summary
        from public.people p where p.id = new.person_id;
    else
      return null;
    end if;

  else -- DELETE
    if not exists (select 1 from public.projects pr where pr.id = old.project_id) then
      return null;
    end if;

    v_entity_id := old.id;
    v_action := 'deleted';
    v_details := jsonb_build_object(
      'parent_type', 'project', 'parent_id', old.project_id,
      'person_id', old.person_id, 'position', old.position
    );

    select nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
      into v_summary
      from public.people p where p.id = old.person_id;
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('project_intermediary', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_project_intermediary_activity$;

drop trigger if exists project_intermediaries_log_activity on public.project_intermediaries;
create trigger project_intermediaries_log_activity
  after insert or update or delete on public.project_intermediaries
  for each row
  execute function public.log_project_intermediary_activity();

revoke all on function public.touch_project_from_intermediary() from public, anon, authenticated;
revoke all on function public.log_receiver_intermediary_activity() from public, anon, authenticated;
revoke all on function public.log_project_intermediary_activity() from public, anon, authenticated;

commit;

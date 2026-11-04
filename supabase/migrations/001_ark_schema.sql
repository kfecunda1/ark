-- ============================================================================
-- Migration 001: ARK schema
--
-- The first real schema for ARK's own (brand-new, empty) Supabase project.
-- Everything under supabase/_jes3_archive/ is the history of the template
-- this app was copied from — it was never run here and never will be.
-- This file is the entire schema in one shot: run it once, manually, in
-- the ARK project's SQL editor.
--
-- Safe to re-run: every statement uses IF NOT EXISTS / CREATE OR REPLACE /
-- DROP ... IF EXISTS guards, same convention the archived migrations used.
--
-- Scope
-- -----
-- Projects, Contacts (+ capability tags), Notes, Documents (with SHA-256
-- duplicate prevention), and the Activity log. Project Tranches (always
-- showing Tranche 1 and 2, with more addable) get a real table. Project
-- Steps (the Phase 3 timeline — "step taken" / "next step" / "note" items)
-- get a table too, so the schema is ready for it, but no UI reads or
-- writes it yet — Phase 3's job.
--
-- No business_line, no wallets, no procedures, no Telegram tables. No
-- profit field, no formulas, no generated columns on projects — every
-- number on a project is typed in by a person.
-- ============================================================================


-- ============================================================================
-- Extensions
-- ============================================================================

create extension if not exists "pgcrypto";


-- ============================================================================
-- Enums
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'product_type') then
    create type public.product_type as enum ('SBLC', 'MX103', 'MT103', 'IP-IP', 'API', 'T2T', 'S2S');
  end if;

  if not exists (select 1 from pg_type where typname = 'project_stage') then
    create type public.project_stage as enum ('new', 'documents_received', 'match', 'status');
  end if;

  if not exists (select 1 from pg_type where typname = 'project_status') then
    create type public.project_status as enum (
      'open', 'with_receiver', 'with_sender', 'waiting', 'in_process', 'completed', 'lost'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'project_priority') then
    create type public.project_priority as enum ('low', 'medium', 'high', 'urgent');
  end if;

  if not exists (select 1 from pg_type where typname = 'project_step_kind') then
    create type public.project_step_kind as enum ('step_taken', 'next_step', 'note');
  end if;

  if not exists (select 1 from pg_type where typname = 'project_document_type') then
    create type public.project_document_type as enum (
      'CIS', 'POF', 'DOA', 'PGL', 'JSON',
      'Proof of Fulfillment', 'Supporting Documents', 'Additional Documents'
    );
  end if;
end $$;


-- ============================================================================
-- profiles
--
-- One row per person allowed to use ARK. A Supabase Auth user becomes a
-- "registered user" (see is_registered_user() below) only once they have
-- a row here — the app creates it on first successful login (see
-- app/login/page.tsx's ensureProfile). For a private two-user tool, that
-- means signups must be disabled at the Supabase Auth level; profiles/
-- is_registered_user() is the second lock on the door, not the first.
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  role text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Helper: does the current authenticated user have a profiles row? Every
-- RLS policy below (on every table, and on the storage bucket) is gated
-- on this. SECURITY DEFINER so it can read profiles regardless of the
-- caller's own row-level access to that table.
create or replace function public.is_registered_user()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid()
  );
$$;

drop policy if exists "profiles_select_registered" on public.profiles;
create policy "profiles_select_registered"
  on public.profiles for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "profiles_delete_self" on public.profiles;
create policy "profiles_delete_self"
  on public.profiles for delete
  to authenticated
  using (id = auth.uid());


-- ============================================================================
-- contacts (+ contact_capabilities)
-- ============================================================================

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  full_name text not null,
  phone text,
  email text,
  notes text
);

alter table public.contacts enable row level security;

drop policy if exists "contacts_select_registered" on public.contacts;
create policy "contacts_select_registered"
  on public.contacts for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "contacts_insert_registered" on public.contacts;
create policy "contacts_insert_registered"
  on public.contacts for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "contacts_update_registered" on public.contacts;
create policy "contacts_update_registered"
  on public.contacts for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "contacts_delete_registered" on public.contacts;
create policy "contacts_delete_registered"
  on public.contacts for delete
  to authenticated
  using (public.is_registered_user());

-- Repeatable free-text capability tags on a contact (e.g. "SWIFT -
-- Issuing Bank"). ON DELETE CASCADE: a capability row only makes sense
-- attached to its contact.
create table if not exists public.contact_capabilities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  tag text not null,
  created_at timestamptz not null default now()
);

create index if not exists contact_capabilities_contact_id_idx on public.contact_capabilities (contact_id);

alter table public.contact_capabilities enable row level security;

drop policy if exists "contact_capabilities_select_registered" on public.contact_capabilities;
create policy "contact_capabilities_select_registered"
  on public.contact_capabilities for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "contact_capabilities_insert_registered" on public.contact_capabilities;
create policy "contact_capabilities_insert_registered"
  on public.contact_capabilities for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "contact_capabilities_update_registered" on public.contact_capabilities;
create policy "contact_capabilities_update_registered"
  on public.contact_capabilities for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "contact_capabilities_delete_registered" on public.contact_capabilities;
create policy "contact_capabilities_delete_registered"
  on public.contact_capabilities for delete
  to authenticated
  using (public.is_registered_user());


-- ============================================================================
-- projects
--
-- client_contact_id / assigned_contact_id both point at contacts, not
-- profiles — there is no "which of our two users is this assigned to"
-- concept here; assigned_contact_id is the external party (receiver,
-- sender, broker, …) the project is currently sitting with.
--
-- status is only meaningful once stage = 'status' (the earlier stages —
-- new / documents_received / match — don't have sub-states); the check
-- constraint below enforces only that direction (required when
-- stage = 'status'), not the reverse, so a project that has already
-- picked up a status keeps it on record even if it's moved stages since.
--
-- archived_at replaces the old boolean "archived" flag: null means
-- active, a timestamp means archived (and records when).
-- ============================================================================

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product_type public.product_type not null,
  stage public.project_stage not null default 'new',
  status public.project_status,
  client_contact_id uuid references public.contacts (id) on delete set null,
  assigned_contact_id uuid references public.contacts (id) on delete set null,
  ratio_presented text,
  ratio_real text,
  total_face_value numeric,
  currency text not null default 'USD',
  priority public.project_priority not null default 'medium',
  archived_at timestamptz,
  last_activity_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_status_required_when_stage_status
    check (stage <> 'status' or status is not null)
);

create index if not exists projects_stage_idx on public.projects (stage);
create index if not exists projects_product_type_idx on public.projects (product_type);
create index if not exists projects_client_contact_id_idx on public.projects (client_contact_id);
create index if not exists projects_assigned_contact_id_idx on public.projects (assigned_contact_id);
create index if not exists projects_archived_at_idx on public.projects (archived_at);

alter table public.projects enable row level security;

drop policy if exists "projects_select_registered" on public.projects;
create policy "projects_select_registered"
  on public.projects for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "projects_insert_registered" on public.projects;
create policy "projects_insert_registered"
  on public.projects for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "projects_update_registered" on public.projects;
create policy "projects_update_registered"
  on public.projects for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "projects_delete_registered" on public.projects;
create policy "projects_delete_registered"
  on public.projects for delete
  to authenticated
  using (public.is_registered_user());

-- updated_at / last_activity_at: both bumped on every projects UPDATE.
-- Phase 3's timeline (project_steps) and project_tranches below also
-- bump the parent project's last_activity_at, so the column reflects
-- "anything happened on this project", not just edits to its own fields.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.last_activity_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row
  execute function public.set_updated_at();


-- ============================================================================
-- project_tranches
--
-- Tranche 1 and 2 are permanent slots the UI always shows (empty/"Not
-- sent" if no row exists yet); "Tranches after" adds 3, 4, … one at a
-- time. amount and sent_on are both manual entry — sent_on null means
-- not sent yet. Unique (project_id, tranche_number) is what the app's
-- upsert (ON CONFLICT) relies on to create-or-update a tranche in one
-- call regardless of whether it already has a row.
-- ============================================================================

create table if not exists public.project_tranches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  tranche_number integer not null check (tranche_number >= 1),
  amount numeric,
  sent_on date,
  notes text,
  created_at timestamptz not null default now(),
  unique (project_id, tranche_number)
);

create index if not exists project_tranches_project_id_idx on public.project_tranches (project_id);

alter table public.project_tranches enable row level security;

drop policy if exists "project_tranches_select_registered" on public.project_tranches;
create policy "project_tranches_select_registered"
  on public.project_tranches for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "project_tranches_insert_registered" on public.project_tranches;
create policy "project_tranches_insert_registered"
  on public.project_tranches for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "project_tranches_update_registered" on public.project_tranches;
create policy "project_tranches_update_registered"
  on public.project_tranches for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "project_tranches_delete_registered" on public.project_tranches;
create policy "project_tranches_delete_registered"
  on public.project_tranches for delete
  to authenticated
  using (public.is_registered_user());

create or replace function public.touch_project_from_tranche()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.projects
     set last_activity_at = now()
   where id = coalesce(new.project_id, old.project_id);
  return null;
end;
$$;

drop trigger if exists project_tranches_touch_project on public.project_tranches;
create trigger project_tranches_touch_project
  after insert or update or delete on public.project_tranches
  for each row
  execute function public.touch_project_from_tranche();


-- ============================================================================
-- project_steps — the Phase 3 timeline
--
-- Table only: no page or component reads or writes this yet. kind
-- distinguishes a logged "step taken" from a planned "next step" (which
-- is the only kind that carries a due_date, enforced below) from a plain
-- note. done is for checking off a next_step once it's handled.
-- ============================================================================

create table if not exists public.project_steps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind public.project_step_kind not null,
  body text not null,
  due_date date,
  done boolean not null default false,
  author_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint project_steps_due_date_only_for_next_step
    check (kind = 'next_step' or due_date is null)
);

create index if not exists project_steps_project_id_idx on public.project_steps (project_id, created_at);

alter table public.project_steps enable row level security;

drop policy if exists "project_steps_select_registered" on public.project_steps;
create policy "project_steps_select_registered"
  on public.project_steps for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "project_steps_insert_registered" on public.project_steps;
create policy "project_steps_insert_registered"
  on public.project_steps for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "project_steps_update_registered" on public.project_steps;
create policy "project_steps_update_registered"
  on public.project_steps for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "project_steps_delete_registered" on public.project_steps;
create policy "project_steps_delete_registered"
  on public.project_steps for delete
  to authenticated
  using (public.is_registered_user());

create or replace function public.touch_project_from_step()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.projects
     set last_activity_at = now()
   where id = coalesce(new.project_id, old.project_id);
  return null;
end;
$$;

drop trigger if exists project_steps_touch_project on public.project_steps;
create trigger project_steps_touch_project
  after insert or update or delete on public.project_steps
  for each row
  execute function public.touch_project_from_step();


-- ============================================================================
-- project_documents (+ private storage bucket)
--
-- SHA-256 duplicate prevention: a unique partial index on
-- (project_id, file_hash) rejects the exact same file being attached
-- twice to the same project, while leaving null-hash rows (there won't
-- be any pre-existing ones here, since this is a brand-new schema, but
-- the app computes the hash client-side before insert either way)
-- unconstrained.
-- ============================================================================

create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  document_type public.project_document_type not null,
  file_path text not null,
  file_name text not null,
  file_hash text,
  created_at timestamptz not null default now()
);

create index if not exists project_documents_project_id_idx on public.project_documents (project_id);
create index if not exists project_documents_file_hash_idx on public.project_documents (file_hash);

create unique index if not exists project_documents_project_id_file_hash_key
  on public.project_documents (project_id, file_hash)
  where file_hash is not null;

alter table public.project_documents enable row level security;

drop policy if exists "project_documents_select_registered" on public.project_documents;
create policy "project_documents_select_registered"
  on public.project_documents for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "project_documents_insert_registered" on public.project_documents;
create policy "project_documents_insert_registered"
  on public.project_documents for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "project_documents_update_registered" on public.project_documents;
create policy "project_documents_update_registered"
  on public.project_documents for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "project_documents_delete_registered" on public.project_documents;
create policy "project_documents_delete_registered"
  on public.project_documents for delete
  to authenticated
  using (public.is_registered_user());

insert into storage.buckets (id, name, public)
values ('project-documents', 'project-documents', false)
on conflict (id) do nothing;

drop policy if exists "project_documents_bucket_select_registered" on storage.objects;
create policy "project_documents_bucket_select_registered"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'project-documents'
    and public.is_registered_user()
  );

drop policy if exists "project_documents_bucket_insert_registered" on storage.objects;
create policy "project_documents_bucket_insert_registered"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'project-documents'
    and public.is_registered_user()
  );

drop policy if exists "project_documents_bucket_update_registered" on storage.objects;
create policy "project_documents_bucket_update_registered"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'project-documents'
    and public.is_registered_user()
  )
  with check (
    bucket_id = 'project-documents'
    and public.is_registered_user()
  );

drop policy if exists "project_documents_bucket_delete_registered" on storage.objects;
create policy "project_documents_bucket_delete_registered"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'project-documents'
    and public.is_registered_user()
  );


-- ============================================================================
-- notes
--
-- A note can optionally be flagged as a reminder (with a due date) and
-- optionally linked to exactly one of a project or a contact. ON DELETE
-- CASCADE: a note attached to a project/contact only makes sense
-- alongside it.
-- ============================================================================

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  title text,
  content text not null,
  is_reminder boolean not null default false,
  due_date date,
  reminded_at timestamptz,
  project_id uuid references public.projects (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  constraint notes_at_most_one_link check (
    (case when project_id is not null then 1 else 0 end)
    + (case when contact_id is not null then 1 else 0 end)
    <= 1
  )
);

create index if not exists notes_project_id_idx on public.notes (project_id);
create index if not exists notes_contact_id_idx on public.notes (contact_id);
create index if not exists notes_reminders_idx on public.notes (is_reminder, due_date, reminded_at);

alter table public.notes enable row level security;

drop policy if exists "notes_select_registered" on public.notes;
create policy "notes_select_registered"
  on public.notes for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "notes_insert_registered" on public.notes;
create policy "notes_insert_registered"
  on public.notes for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "notes_update_registered" on public.notes;
create policy "notes_update_registered"
  on public.notes for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "notes_delete_registered" on public.notes;
create policy "notes_delete_registered"
  on public.notes for delete
  to authenticated
  using (public.is_registered_user());


-- ============================================================================
-- activity_log
--
-- Append-only, written exclusively by the AFTER row triggers below on
-- projects / contacts / project_documents. RLS has a SELECT policy only
-- — no INSERT/UPDATE/DELETE policy at all — so even a registered user
-- cannot forge or rewrite history; only the SECURITY DEFINER trigger
-- functions can write here.
--
-- details shape: a *state* value is a scalar ("stage": "new", on
-- created/deleted), a *change* a two-element before/after array
-- ("stage": ["new", "match"], on updated). "fields" always holds the
-- list of changed column names on an update.
--
-- Document deletions caused only by their parent project going away are
-- NOT logged: in the AFTER DELETE trigger the already-deleted parent row
-- is no longer visible, so a parent-existence check cleanly identifies a
-- cascade.
-- ============================================================================

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entity_type text not null check (entity_type in ('project', 'contact', 'project_document')),
  entity_id uuid not null,
  action text not null check (action in ('created', 'updated', 'deleted')),
  summary text,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_label text
);

create index if not exists activity_log_created_at_idx on public.activity_log (created_at desc);

alter table public.activity_log enable row level security;

drop policy if exists "activity_log_select_registered" on public.activity_log;
create policy "activity_log_select_registered"
  on public.activity_log for select
  to authenticated
  using (public.is_registered_user());


-- ----------------------------------------------------------------------------
-- Helper: who is acting
-- ----------------------------------------------------------------------------

create or replace function public.activity_actor(
  out actor_id uuid,
  out actor_label text
)
language plpgsql
security definer
set search_path = public
stable
as $activity_actor$
declare
  uid uuid := auth.uid();
  prof record;
begin
  actor_id := null;

  if uid is null then
    -- Service role: maintenance scripts, direct SQL. ARK has no cron or
    -- webhook writing through this path.
    actor_label := 'System';
    return;
  end if;

  select p.id, p.full_name, p.email
    into prof
    from public.profiles p
   where p.id = uid;

  if found then
    actor_id := prof.id;
    actor_label := coalesce(
      nullif(btrim(prof.full_name), ''),
      nullif(btrim(prof.email), ''),
      'Unknown user'
    );
  else
    -- Authenticated but unregistered: actor_id must stay null (FK), and
    -- the RLS policies would have blocked the write anyway.
    actor_label := 'Unknown user';
  end if;
end;
$activity_actor$;


-- ----------------------------------------------------------------------------
-- Helper: which columns actually changed
-- ----------------------------------------------------------------------------

create or replace function public.activity_changed_fields(
  p_old jsonb,
  p_new jsonb,
  p_ignore text[] default '{}'::text[]
)
returns text[]
language sql
immutable
as $activity_changed_fields$
  select coalesce(array_agg(k.key order by k.key), '{}'::text[])
    from (
      select key from jsonb_each(p_old)
      union
      select key from jsonb_each(p_new)
    ) k
   where not (k.key = any(p_ignore))
     and (p_old -> k.key) is distinct from (p_new -> k.key);
$activity_changed_fields$;


-- ----------------------------------------------------------------------------
-- Trigger: projects
-- ----------------------------------------------------------------------------

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
    v_details := jsonb_build_object('stage', new.stage, 'product_type', new.product_type, 'priority', new.priority);

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
    if (new.archived_at is not null) is distinct from (old.archived_at is not null) then
      v_details := v_details || jsonb_build_object('archived', jsonb_build_array(old.archived_at is not null, new.archived_at is not null));
    end if;

  else -- DELETE
    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := old.name;
    v_details := jsonb_build_object('stage', old.stage, 'product_type', old.product_type);
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('project', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_project_activity$;

drop trigger if exists projects_log_activity on public.projects;
create trigger projects_log_activity
  after insert or update or delete on public.projects
  for each row
  execute function public.log_project_activity();


-- ----------------------------------------------------------------------------
-- Trigger: contacts
-- ----------------------------------------------------------------------------

create or replace function public.log_contact_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_contact_activity$
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
    v_summary := nullif(btrim(new.full_name), '');
    v_details := '{}'::jsonb;

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new));

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := nullif(btrim(new.full_name), '');
    v_details := jsonb_build_object('fields', to_jsonb(v_changed));

    if new.full_name is distinct from old.full_name then
      v_details := v_details || jsonb_build_object(
        'full_name', jsonb_build_array(old.full_name, new.full_name)
      );
    end if;

  else -- DELETE
    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := nullif(btrim(old.full_name), '');
    v_details := '{}'::jsonb;
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('contact', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_contact_activity$;

drop trigger if exists contacts_log_activity on public.contacts;
create trigger contacts_log_activity
  after insert or update or delete on public.contacts
  for each row
  execute function public.log_contact_activity();


-- ----------------------------------------------------------------------------
-- Trigger: project_documents
--
-- A DELETE whose parent project is already gone is a cascade from
-- deleting the project, not a document someone removed on purpose; the
-- project's own 'deleted' row already says what happened, so skip it.
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
begin
  if tg_op = 'INSERT' then
    v_entity_id := new.id;
    v_action := 'created';
    v_summary := new.file_name;
    v_details := jsonb_build_object(
      'parent_type', 'project',
      'parent_id', new.project_id,
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
      'parent_type', 'project',
      'parent_id', new.project_id,
      'document_type', new.document_type,
      'fields', to_jsonb(v_changed)
    );

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
      'document_type', old.document_type
    );
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('project_document', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_project_document_activity$;

drop trigger if exists project_documents_log_activity on public.project_documents;
create trigger project_documents_log_activity
  after insert or update or delete on public.project_documents
  for each row
  execute function public.log_project_document_activity();


-- ============================================================================
-- Lock down helper and trigger functions
--
-- Every function above is SECURITY DEFINER in the public schema. Supabase
-- exposes public-schema functions as callable PostgREST RPC endpoints,
-- and Postgres grants EXECUTE on a new function to PUBLIC by default.
-- Left alone, that means anyone holding the anon key could call a
-- SECURITY DEFINER function like log_project_activity() or
-- activity_actor() directly over the API and have it run with this
-- migration's privileges — bypassing activity_log's RLS (which has no
-- INSERT policy at all) and reading/writing through whatever each
-- function touches, regardless of the caller's own role.
--
-- Revoking EXECUTE from public/anon/authenticated closes that off. The
-- trigger functions (returns trigger) are unaffected: Postgres only
-- checks EXECUTE privilege on a trigger function at CREATE TRIGGER time,
-- never when the trigger itself fires, so every AFTER INSERT/UPDATE/
-- DELETE trigger above keeps working exactly as before. is_registered_
-- user() is deliberately NOT revoked — every RLS policy in this file
-- calls it from the querying user's own session (not from inside a
-- trigger), so it must stay executable by authenticated.
-- ============================================================================

revoke all on function public.activity_actor() from public, anon, authenticated;
revoke all on function public.activity_changed_fields(jsonb, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.log_project_activity() from public, anon, authenticated;
revoke all on function public.log_contact_activity() from public, anon, authenticated;
revoke all on function public.log_project_document_activity() from public, anon, authenticated;
revoke all on function public.touch_project_from_tranche() from public, anon, authenticated;
revoke all on function public.touch_project_from_step() from public, anon, authenticated;

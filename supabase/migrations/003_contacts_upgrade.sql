-- ============================================================================
-- Migration 003: Contacts upgrade
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- and 002_currency_check.sql have already been applied. Safe to re-run:
-- every statement uses IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF
-- EXISTS guards.
--
-- What this does
-- --------------
-- 1. Drops contacts.phone and contacts.email — a contact is now just a
--    name plus its products/ratios/documents/notes.
-- 2. Replaces contact_capabilities (free-text tags) with contact_products
--    (one structured row per product a contact handles, with its ratio).
-- 3. Adds contact_documents — the same shape as project_documents,
--    including SHA-256 duplicate prevention — in a new private
--    "contact-documents" bucket.
-- 4. Adds projects.matched_contact_id, alongside the existing
--    client_contact_id / assigned_contact_id (both left untouched).
-- 5. RLS + activity-log triggers on everything new, matching the
--    "registered user" pattern and SECURITY DEFINER / fixed search_path
--    convention every other table and trigger in 001 already uses.
-- ============================================================================


-- ============================================================================
-- 1. contacts: drop phone and email
-- ============================================================================

alter table public.contacts
  drop column if exists phone;

alter table public.contacts
  drop column if exists email;


-- ============================================================================
-- 2. contact_products (replaces contact_capabilities)
--
-- One row per product a contact handles, with the ratio they offer on
-- it (free text — "2%", "70/30", whatever notation is in use) and a
-- notes field for anything that doesn't fit the ratio itself. Unique
-- (contact_id, product_type): a contact has at most one ratio on record
-- per product, not several competing ones.
-- ============================================================================

create table if not exists public.contact_products (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  product_type public.product_type not null,
  ratio text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contact_id, product_type)
);

create index if not exists contact_products_contact_id_idx on public.contact_products (contact_id);
create index if not exists contact_products_product_type_idx on public.contact_products (product_type);

alter table public.contact_products enable row level security;

drop policy if exists "contact_products_select_registered" on public.contact_products;
create policy "contact_products_select_registered"
  on public.contact_products for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "contact_products_insert_registered" on public.contact_products;
create policy "contact_products_insert_registered"
  on public.contact_products for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "contact_products_update_registered" on public.contact_products;
create policy "contact_products_update_registered"
  on public.contact_products for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "contact_products_delete_registered" on public.contact_products;
create policy "contact_products_delete_registered"
  on public.contact_products for delete
  to authenticated
  using (public.is_registered_user());

-- contact_products has its own updated_at but no last_activity_at (that
-- column lives only on projects) — a dedicated trigger function rather
-- than reusing projects' set_updated_at(), which also touches
-- last_activity_at and would fail on a table that has no such column.
create or replace function public.set_updated_at_only()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists contact_products_set_updated_at on public.contact_products;
create trigger contact_products_set_updated_at
  before update on public.contact_products
  for each row
  execute function public.set_updated_at_only();

-- Drops the table this replaces. CASCADE takes its policies with it
-- (nothing else references it by FK).
drop table if exists public.contact_capabilities cascade;


-- ============================================================================
-- 3. contact_documents (+ private storage bucket)
--
-- Same shape as project_documents, including the same document_type
-- enum and the same SHA-256 duplicate-prevention index — just owned by
-- a contact instead of a project, in its own bucket.
-- ============================================================================

create table if not exists public.contact_documents (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  document_type public.project_document_type not null,
  file_path text not null,
  file_name text not null,
  file_hash text,
  created_at timestamptz not null default now()
);

create index if not exists contact_documents_contact_id_idx on public.contact_documents (contact_id);
create index if not exists contact_documents_file_hash_idx on public.contact_documents (file_hash);

create unique index if not exists contact_documents_contact_id_file_hash_key
  on public.contact_documents (contact_id, file_hash)
  where file_hash is not null;

alter table public.contact_documents enable row level security;

drop policy if exists "contact_documents_select_registered" on public.contact_documents;
create policy "contact_documents_select_registered"
  on public.contact_documents for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "contact_documents_insert_registered" on public.contact_documents;
create policy "contact_documents_insert_registered"
  on public.contact_documents for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "contact_documents_update_registered" on public.contact_documents;
create policy "contact_documents_update_registered"
  on public.contact_documents for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "contact_documents_delete_registered" on public.contact_documents;
create policy "contact_documents_delete_registered"
  on public.contact_documents for delete
  to authenticated
  using (public.is_registered_user());

insert into storage.buckets (id, name, public)
values ('contact-documents', 'contact-documents', false)
on conflict (id) do nothing;

drop policy if exists "contact_documents_bucket_select_registered" on storage.objects;
create policy "contact_documents_bucket_select_registered"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'contact-documents'
    and public.is_registered_user()
  );

drop policy if exists "contact_documents_bucket_insert_registered" on storage.objects;
create policy "contact_documents_bucket_insert_registered"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'contact-documents'
    and public.is_registered_user()
  );

drop policy if exists "contact_documents_bucket_update_registered" on storage.objects;
create policy "contact_documents_bucket_update_registered"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'contact-documents'
    and public.is_registered_user()
  )
  with check (
    bucket_id = 'contact-documents'
    and public.is_registered_user()
  );

drop policy if exists "contact_documents_bucket_delete_registered" on storage.objects;
create policy "contact_documents_bucket_delete_registered"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'contact-documents'
    and public.is_registered_user()
  );


-- ============================================================================
-- 4. projects.matched_contact_id
--
-- client_contact_id / assigned_contact_id are untouched. This is a
-- third, independent contact reference — the "Matched with" contact the
-- app's ratio auto-fill (components/projects/project-form.tsx) reads
-- from.
-- ============================================================================

alter table public.projects
  add column if not exists matched_contact_id uuid references public.contacts (id) on delete set null;

create index if not exists projects_matched_contact_id_idx on public.projects (matched_contact_id);


-- ============================================================================
-- 5. Activity log: widen entity_type, add triggers for the two new
-- tables
-- ============================================================================

alter table public.activity_log
  drop constraint if exists activity_log_entity_type_check;

alter table public.activity_log
  add constraint activity_log_entity_type_check
  check (entity_type in ('project', 'contact', 'project_document', 'contact_product', 'contact_document'));

create or replace function public.log_contact_product_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_contact_product_activity$
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
    v_summary := new.product_type::text;
    v_details := jsonb_build_object('parent_type', 'contact', 'parent_id', new.contact_id, 'product_type', new.product_type);

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new), array['updated_at']);

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := new.product_type::text;
    v_details := jsonb_build_object(
      'parent_type', 'contact',
      'parent_id', new.contact_id,
      'product_type', new.product_type,
      'fields', to_jsonb(v_changed)
    );

  else -- DELETE
    if not exists (select 1 from public.contacts c where c.id = old.contact_id) then
      return null;
    end if;

    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := old.product_type::text;
    v_details := jsonb_build_object('parent_type', 'contact', 'parent_id', old.contact_id, 'product_type', old.product_type);
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('contact_product', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_contact_product_activity$;

drop trigger if exists contact_products_log_activity on public.contact_products;
create trigger contact_products_log_activity
  after insert or update or delete on public.contact_products
  for each row
  execute function public.log_contact_product_activity();

-- Same shape, and the same cascade guard, as log_project_document_
-- activity: a DELETE whose parent contact is already gone is the
-- cascade from deleting the contact, not a document someone removed on
-- purpose.
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

drop trigger if exists contact_documents_log_activity on public.contact_documents;
create trigger contact_documents_log_activity
  after insert or update or delete on public.contact_documents
  for each row
  execute function public.log_contact_document_activity();


-- ============================================================================
-- Lock down the two new trigger functions — same reasoning as
-- 001_ark_schema.sql's "Lock down helper and trigger functions" section:
-- every function here is SECURITY DEFINER, and Postgres grants EXECUTE
-- on a new function to PUBLIC by default, which would otherwise let
-- anyone holding the anon key call these directly as a PostgREST RPC and
-- have them run with this migration's privileges. Trigger use is
-- unaffected: Postgres only checks EXECUTE at CREATE TRIGGER time, never
-- when the trigger fires.
-- ============================================================================

revoke all on function public.log_contact_product_activity() from public, anon, authenticated;
revoke all on function public.log_contact_document_activity() from public, anon, authenticated;

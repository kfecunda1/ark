-- ============================================================================
-- Migration 036: Templates library
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 035_meeting_notes.sql have already been applied. Safe to
-- re-run — every statement uses IF NOT EXISTS / DROP ... IF EXISTS
-- before CREATE / CREATE OR REPLACE.
--
-- Order: widen the existing activity_log_entity_type_check FIRST (same
-- lesson every migration since 013_projects_restructure.sql has
-- followed), then the three new tables (so FKs onto templates resolve),
-- then the new storage bucket, then every trigger last.
--
-- Scope
-- -----
-- A shared library of downloadable file templates (PGL/CIS/etc.
-- boilerplate documents), versioned, grouped by document type and
-- taggable with the products they apply to. Read by every registered
-- user; only an admin (is_admin()) can create, edit, upload a new
-- version, hide/show, or delete one.
--
--   1. activity_log_entity_type_check rebuilt from the full current
--      list (001_ark_schema.sql through 035_meeting_notes.sql) plus
--      'template' and 'template_version'.
--   2. templates — name (required), description, document_type (→
--      document_types(name) on update cascade, nullable — "Other" in
--      the app when unset), active (hide/show, same soft-hide shape as
--      products/document_types), sort_order, created_by, created_at,
--      updated_at.
--   3. template_products — which products a template applies to.
--      Unique (template_id, product), product → products(name) on
--      update cascade. No sort_order of its own — a template usually
--      has only a couple of product tags, shown as an unordered set of
--      chips, not a sequence.
--   4. template_versions — the actual files. version_number is 1, 2,
--      3… per template (unique (template_id, version_number)); the
--      *current* version is simply whichever has the highest number,
--      computed by every reader rather than stored as a flag, so there
--      is nothing to keep in sync when a new version is added. Always a
--      real file (file_path/file_name/mime_type/file_size/file_hash
--      all NOT NULL) — unlike project_documents/opportunity_documents/
--      note_documents, a template version is never a bare link, so
--      there's no file_path/url mutual-exclusivity constraint here.
--      notes ("what changed") is free text, nullable. Rows are
--      immutable once inserted (a correction is a new version, not an
--      edit) — no UPDATE policy, no update trigger branch.
--   5. New private storage bucket "templates" — PDF, DOC/DOCX,
--      XLS/XLSX, ODT, TXT, plus JPG/PNG, 50 MB limit, same shape as
--      every other document bucket.
--   6. RLS, every one of the three tables and the bucket: registered
--      users read everything; only an admin writes (insert/update/
--      delete) — unlike every other document-ish table in this schema
--      (project_documents, opportunity_documents, note_documents, all
--      registered-write), because a template is a shared, curated
--      asset rather than per-record working data.
--   7. Triggers: log_template_activity() (entity_type 'template',
--      generic column diff — covers created/renamed/hidden-shown/
--      deleted with no extra code, same shape as log_product_activity()/
--      log_opportunity_activity()) and log_template_version_activity()
--      (entity_type 'template_version', INSERT only — a new version is
--      the only thing that ever happens to a template_versions row;
--      its cascade-delete when the parent template is removed is not
--      logged, same "the parent's own deleted row already says enough"
--      reasoning as every child-document trigger's DELETE branch, just
--      achieved here by never having a DELETE branch at all). template_
--      products gets no trigger of its own — same as project_products'
--      sibling opportunity_products, a join table's own add/remove
--      rides along under the parent's "updated" row, not logged
--      individually.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Widen activity_log_entity_type_check
-- ----------------------------------------------------------------------------

alter table public.activity_log
  drop constraint if exists activity_log_entity_type_check;

alter table public.activity_log
  add constraint activity_log_entity_type_check
  check (entity_type in (
    'project', 'contact', 'project_document', 'contact_product', 'contact_document',
    'project_step', 'backup', 'password_change', 'product', 'document_type', 'app_settings',
    'user', 'project_product', 'note', 'person', 'receiver_intermediary', 'project_intermediary',
    'status', 'project_tranche', 'opportunity', 'opportunity_document',
    'note_participant', 'note_document', 'template', 'template_version'
  ));

-- ----------------------------------------------------------------------------
-- 2. templates
-- ----------------------------------------------------------------------------

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  document_type text references public.document_types (name) on update cascade,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists templates_document_type_idx on public.templates (document_type);
create index if not exists templates_active_idx on public.templates (active);

alter table public.templates enable row level security;

drop policy if exists "templates_select_registered" on public.templates;
create policy "templates_select_registered"
  on public.templates for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "templates_insert_admin" on public.templates;
create policy "templates_insert_admin"
  on public.templates for insert
  to authenticated
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "templates_update_admin" on public.templates;
create policy "templates_update_admin"
  on public.templates for update
  to authenticated
  using (public.is_registered_user() and public.is_admin())
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "templates_delete_admin" on public.templates;
create policy "templates_delete_admin"
  on public.templates for delete
  to authenticated
  using (public.is_registered_user() and public.is_admin());

drop trigger if exists templates_set_updated_at on public.templates;
create trigger templates_set_updated_at
  before update on public.templates
  for each row
  execute function public.set_updated_at_only();

-- ----------------------------------------------------------------------------
-- 3. template_products
-- ----------------------------------------------------------------------------

create table if not exists public.template_products (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  product text not null references public.products (name) on update cascade,
  created_at timestamptz not null default now(),
  unique (template_id, product)
);

create index if not exists template_products_template_id_idx on public.template_products (template_id);

alter table public.template_products enable row level security;

drop policy if exists "template_products_select_registered" on public.template_products;
create policy "template_products_select_registered"
  on public.template_products for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "template_products_insert_admin" on public.template_products;
create policy "template_products_insert_admin"
  on public.template_products for insert
  to authenticated
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "template_products_update_admin" on public.template_products;
create policy "template_products_update_admin"
  on public.template_products for update
  to authenticated
  using (public.is_registered_user() and public.is_admin())
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "template_products_delete_admin" on public.template_products;
create policy "template_products_delete_admin"
  on public.template_products for delete
  to authenticated
  using (public.is_registered_user() and public.is_admin());

-- ----------------------------------------------------------------------------
-- 4. template_versions (+ private storage bucket)
-- ----------------------------------------------------------------------------

create table if not exists public.template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  version_number integer not null check (version_number > 0),
  file_path text not null,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null,
  file_hash text,
  notes text,
  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  unique (template_id, version_number)
);

create index if not exists template_versions_template_id_idx on public.template_versions (template_id);

alter table public.template_versions enable row level security;

drop policy if exists "template_versions_select_registered" on public.template_versions;
create policy "template_versions_select_registered"
  on public.template_versions for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "template_versions_insert_admin" on public.template_versions;
create policy "template_versions_insert_admin"
  on public.template_versions for insert
  to authenticated
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "template_versions_update_admin" on public.template_versions;
create policy "template_versions_update_admin"
  on public.template_versions for update
  to authenticated
  using (public.is_registered_user() and public.is_admin())
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "template_versions_delete_admin" on public.template_versions;
create policy "template_versions_delete_admin"
  on public.template_versions for delete
  to authenticated
  using (public.is_registered_user() and public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'templates',
  'templates',
  false,
  52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.text',
    'text/plain',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do nothing;

drop policy if exists "templates_bucket_select_registered" on storage.objects;
create policy "templates_bucket_select_registered"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'templates'
    and public.is_registered_user()
  );

drop policy if exists "templates_bucket_insert_admin" on storage.objects;
create policy "templates_bucket_insert_admin"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'templates'
    and public.is_registered_user()
    and public.is_admin()
  );

drop policy if exists "templates_bucket_update_admin" on storage.objects;
create policy "templates_bucket_update_admin"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'templates'
    and public.is_registered_user()
    and public.is_admin()
  )
  with check (
    bucket_id = 'templates'
    and public.is_registered_user()
    and public.is_admin()
  );

drop policy if exists "templates_bucket_delete_admin" on storage.objects;
create policy "templates_bucket_delete_admin"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'templates'
    and public.is_registered_user()
    and public.is_admin()
  );

-- ----------------------------------------------------------------------------
-- 5a. Trigger: templates — generic column diff, same shape as
--     log_product_activity()/log_document_type_activity() (011_settings_
--     tables.sql): covers "created"/"renamed"/"hidden"/"shown"/"deleted"
--     with no entity-specific code at all (lib/activity.ts's generic
--     'name' and 'active' chips already render those).
-- ----------------------------------------------------------------------------

create or replace function public.log_template_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_template_activity$
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
    v_details := jsonb_build_object('active', new.active, 'document_type', new.document_type);

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

  else -- DELETE
    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := old.name;
    v_details := '{}'::jsonb;
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('template', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_template_activity$;

drop trigger if exists templates_log_activity on public.templates;
create trigger templates_log_activity
  after insert or update or delete on public.templates
  for each row
  execute function public.log_template_activity();

-- ----------------------------------------------------------------------------
-- 5b. Trigger: template_versions — INSERT only ("new version"); there
--     is no UPDATE (rows are immutable) and no DELETE branch (the only
--     delete path is the parent template's own cascade, already
--     covered by that row's own 'deleted' entry).
-- ----------------------------------------------------------------------------

create or replace function public.log_template_version_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_template_version_activity$
declare
  v_actor_id uuid;
  v_actor_label text;
  v_template_name text;
begin
  select t.name into v_template_name from public.templates t where t.id = new.template_id;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values (
    'template_version',
    new.id,
    'created',
    coalesce(v_template_name, new.file_name),
    jsonb_build_object(
      'parent_type', 'template',
      'parent_id', new.template_id,
      'version_number', new.version_number
    ),
    v_actor_id,
    v_actor_label
  );

  return null;
end;
$log_template_version_activity$;

drop trigger if exists template_versions_log_activity on public.template_versions;
create trigger template_versions_log_activity
  after insert on public.template_versions
  for each row
  execute function public.log_template_version_activity();

revoke all on function public.log_template_activity() from public, anon, authenticated;
revoke all on function public.log_template_version_activity() from public, anon, authenticated;

commit;

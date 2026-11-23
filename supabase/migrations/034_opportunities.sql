-- ============================================================================
-- Migration 034: Opportunities
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 033_nicknames.sql have already been applied. Safe to re-run —
-- every statement uses IF NOT EXISTS / DROP ... IF EXISTS before CREATE /
-- CREATE OR REPLACE.
--
-- Order, same lesson 013_projects_restructure.sql already learned the
-- hard way: widen activity_log_entity_type_check FIRST (before anything
-- later in this file could possibly write one of the two new entity
-- types), then the new tables (so FKs onto them resolve), then notes'
-- own "at most one link" constraint (it has to come after opportunities
-- exists, since it now references it), then every trigger last.
--
-- Scope
-- -----
-- Opportunities are a holding place for documents and notes that arrive
-- before a project or receiver exists yet — a lightweight record (title,
-- an optional intermediary, 0-3 product options, a free-text summary)
-- that eventually either converts into a real Project, gets attached to
-- an existing Receiver, or is closed as not matched.
--
--   1. activity_log_entity_type_check rebuilt from the full current list
--      (001_ark_schema.sql through 033_nicknames.sql) plus 'opportunity'
--      and 'opportunity_document'.
--   2. opportunities — title (required), intermediary_person_id (→
--      people, nullable), notes_summary (free text, same role as
--      contacts.notes), status ('open'/'converted'/'closed'),
--      converted_to_type/converted_to_id (set together, only once
--      status = 'converted' — opportunities_status_converted_consistent
--      enforces both directions), closed_reason, last_activity_at,
--      created_by, created_at, updated_at. Reuses 001_ark_schema.sql's
--      existing set_updated_at() trigger function (it only ever touches
--      updated_at/last_activity_at, nothing opportunity-specific).
--   3. opportunity_products — same shape as project_products (013_
--      projects_restructure.sql): 0-3 rows (enforced by the app, not a
--      DB check — the DB side is just FK + unique(opportunity_id,
--      product), same as project_products itself), each referencing
--      products(name) on update cascade. No "final product" concept —
--      opportunities never settle on one. touch_opportunity_from_
--      product mirrors touch_project_from_product (013_projects_
--      restructure.sql): adding/removing a product option counts as
--      activity on the opportunity.
--   4. opportunity_documents — same shape as project_documents: file_path/
--      url mutually exclusive (020_media_uploads.sql's pattern),
--      SHA-256 duplicate detection (a unique partial index on
--      (opportunity_id, file_hash)), document_type referencing
--      document_types(name) on update cascade. New private storage
--      bucket "opportunity-documents", same 50 MB limit and allowed
--      mime types as project-documents/contact-documents. No tranche_id
--      — opportunities have no tranches, so there's nothing to "move"
--      a document between; the app's own Documents section for an
--      opportunity is just upload/link/preview/rename/delete. Unlike
--      project_documents, there's no touch-last-activity trigger here
--      either, for the same reason project_documents itself has never
--      had one.
--   5. notes.opportunity_id — a note can now link to a project, a
--      contact, or an opportunity (never more than one — notes_at_most_
--      one_link widened to a 3-way sum). log_note_activity() and a new
--      touch_opportunity_from_note() are rebuilt/added so an
--      opportunity-linked note behaves exactly like a project-linked
--      one already does.
--   6. Triggers: log_opportunity_activity() (entity_type 'opportunity')
--      and log_opportunity_document_activity() (entity_type
--      'opportunity_document', parent_type 'opportunity' — same cascade-
--      delete skip project_documents' own trigger already uses).
--
-- RLS follows the same "is_registered_user() for select/insert/update,
-- is_admin() additionally for delete" shape as projects/contacts
-- (026_delete_project.sql, 017_archive_receivers_people.sql) — delete on
-- the opportunities table itself is admin-only; opportunity_products/
-- opportunity_documents stay registered-delete, same as project_products/
-- project_documents.
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
    'status', 'project_tranche', 'opportunity', 'opportunity_document'
  ));

-- ----------------------------------------------------------------------------
-- 2. opportunities
-- ----------------------------------------------------------------------------

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  intermediary_person_id uuid references public.people (id) on delete set null,
  notes_summary text,
  status text not null default 'open' check (status in ('open', 'converted', 'closed')),
  converted_to_type text check (converted_to_type in ('project', 'receiver')),
  converted_to_id uuid,
  closed_reason text,
  last_activity_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opportunities_converted_to_consistent check (
    (converted_to_type is null and converted_to_id is null)
    or (converted_to_type is not null and converted_to_id is not null)
  ),
  constraint opportunities_status_converted_consistent check (
    (status = 'converted') = (converted_to_type is not null)
  )
);

create index if not exists opportunities_status_idx on public.opportunities (status);
create index if not exists opportunities_intermediary_person_id_idx on public.opportunities (intermediary_person_id);
create index if not exists opportunities_last_activity_at_idx on public.opportunities (last_activity_at);

alter table public.opportunities enable row level security;

drop policy if exists "opportunities_select_registered" on public.opportunities;
create policy "opportunities_select_registered"
  on public.opportunities for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "opportunities_insert_registered" on public.opportunities;
create policy "opportunities_insert_registered"
  on public.opportunities for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "opportunities_update_registered" on public.opportunities;
create policy "opportunities_update_registered"
  on public.opportunities for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "opportunities_delete_admin" on public.opportunities;
create policy "opportunities_delete_admin"
  on public.opportunities for delete
  to authenticated
  using (public.is_registered_user() and public.is_admin());

drop trigger if exists opportunities_set_updated_at on public.opportunities;
create trigger opportunities_set_updated_at
  before update on public.opportunities
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. opportunity_products
-- ----------------------------------------------------------------------------

create table if not exists public.opportunity_products (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  product text not null references public.products (name) on update cascade,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  unique (opportunity_id, product)
);

create index if not exists opportunity_products_opportunity_id_idx on public.opportunity_products (opportunity_id);

alter table public.opportunity_products enable row level security;

drop policy if exists "opportunity_products_select_registered" on public.opportunity_products;
create policy "opportunity_products_select_registered"
  on public.opportunity_products for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "opportunity_products_insert_registered" on public.opportunity_products;
create policy "opportunity_products_insert_registered"
  on public.opportunity_products for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "opportunity_products_update_registered" on public.opportunity_products;
create policy "opportunity_products_update_registered"
  on public.opportunity_products for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "opportunity_products_delete_registered" on public.opportunity_products;
create policy "opportunity_products_delete_registered"
  on public.opportunity_products for delete
  to authenticated
  using (public.is_registered_user());

create or replace function public.touch_opportunity_from_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $touch_opportunity_from_product$
begin
  update public.opportunities
     set last_activity_at = now()
   where id = coalesce(new.opportunity_id, old.opportunity_id);
  return null;
end;
$touch_opportunity_from_product$;

drop trigger if exists opportunity_products_touch_opportunity on public.opportunity_products;
create trigger opportunity_products_touch_opportunity
  after insert or update or delete on public.opportunity_products
  for each row
  execute function public.touch_opportunity_from_product();

-- ----------------------------------------------------------------------------
-- 4. opportunity_documents (+ private storage bucket)
-- ----------------------------------------------------------------------------

create table if not exists public.opportunity_documents (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  document_type text not null references public.document_types (name) on update cascade,
  file_path text,
  file_name text not null,
  file_hash text,
  url text,
  created_at timestamptz not null default now(),
  constraint opportunity_documents_file_path_or_url_check check (
    (file_path is not null and url is null)
    or (file_path is null and url is not null)
  )
);

create index if not exists opportunity_documents_opportunity_id_idx on public.opportunity_documents (opportunity_id);
create index if not exists opportunity_documents_file_hash_idx on public.opportunity_documents (file_hash);

create unique index if not exists opportunity_documents_opportunity_id_file_hash_key
  on public.opportunity_documents (opportunity_id, file_hash)
  where file_hash is not null;

alter table public.opportunity_documents enable row level security;

drop policy if exists "opportunity_documents_select_registered" on public.opportunity_documents;
create policy "opportunity_documents_select_registered"
  on public.opportunity_documents for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "opportunity_documents_insert_registered" on public.opportunity_documents;
create policy "opportunity_documents_insert_registered"
  on public.opportunity_documents for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "opportunity_documents_update_registered" on public.opportunity_documents;
create policy "opportunity_documents_update_registered"
  on public.opportunity_documents for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "opportunity_documents_delete_registered" on public.opportunity_documents;
create policy "opportunity_documents_delete_registered"
  on public.opportunity_documents for delete
  to authenticated
  using (public.is_registered_user());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'opportunity-documents',
  'opportunity-documents',
  false,
  52428800,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

drop policy if exists "opportunity_documents_bucket_select_registered" on storage.objects;
create policy "opportunity_documents_bucket_select_registered"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'opportunity-documents'
    and public.is_registered_user()
  );

drop policy if exists "opportunity_documents_bucket_insert_registered" on storage.objects;
create policy "opportunity_documents_bucket_insert_registered"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'opportunity-documents'
    and public.is_registered_user()
  );

drop policy if exists "opportunity_documents_bucket_update_registered" on storage.objects;
create policy "opportunity_documents_bucket_update_registered"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'opportunity-documents'
    and public.is_registered_user()
  )
  with check (
    bucket_id = 'opportunity-documents'
    and public.is_registered_user()
  );

drop policy if exists "opportunity_documents_bucket_delete_registered" on storage.objects;
create policy "opportunity_documents_bucket_delete_registered"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'opportunity-documents'
    and public.is_registered_user()
  );

-- ----------------------------------------------------------------------------
-- 5. notes.opportunity_id + widened "at most one link" constraint
-- ----------------------------------------------------------------------------

alter table public.notes
  add column if not exists opportunity_id uuid references public.opportunities (id) on delete cascade;

alter table public.notes
  drop constraint if exists notes_at_most_one_link;

alter table public.notes
  add constraint notes_at_most_one_link check (
    (case when project_id is not null then 1 else 0 end)
    + (case when contact_id is not null then 1 else 0 end)
    + (case when opportunity_id is not null then 1 else 0 end)
    <= 1
  );

create index if not exists notes_opportunity_id_idx on public.notes (opportunity_id);

-- ----------------------------------------------------------------------------
-- 6a. Trigger: opportunities
-- ----------------------------------------------------------------------------

create or replace function public.log_opportunity_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_opportunity_activity$
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
    v_summary := new.title;
    v_details := jsonb_build_object('status', new.status, 'intermediary_person_id', new.intermediary_person_id);

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(
      to_jsonb(old),
      to_jsonb(new),
      array['updated_at', 'last_activity_at']
    );

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := new.title;
    v_details := jsonb_build_object('fields', to_jsonb(v_changed));

    -- Reuses the generic "name" chip (lib/activity.ts already renders
    -- details.name as "renamed X -> Y") rather than a new title-specific
    -- key — title is this table's own equivalent of products'/document_
    -- types' `name` column.
    if new.title is distinct from old.title then
      v_details := v_details || jsonb_build_object('name', jsonb_build_array(old.title, new.title));
    end if;
    if new.status is distinct from old.status then
      v_details := v_details || jsonb_build_object('status', jsonb_build_array(old.status, new.status));
    end if;
    if new.converted_to_type is distinct from old.converted_to_type and new.converted_to_type is not null then
      v_details := v_details || jsonb_build_object('converted_to_type', new.converted_to_type);
    end if;

  else -- DELETE
    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := old.title;
    v_details := jsonb_build_object('status', old.status);
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('opportunity', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_opportunity_activity$;

drop trigger if exists opportunities_log_activity on public.opportunities;
create trigger opportunities_log_activity
  after insert or update or delete on public.opportunities
  for each row
  execute function public.log_opportunity_activity();

-- ----------------------------------------------------------------------------
-- 6b. Trigger: opportunity_documents — same shape (and same cascade-
--     delete skip) as log_project_document_activity() (001_ark_schema.sql).
-- ----------------------------------------------------------------------------

create or replace function public.log_opportunity_document_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_opportunity_document_activity$
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
      'parent_type', 'opportunity',
      'parent_id', new.opportunity_id,
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
      'parent_type', 'opportunity',
      'parent_id', new.opportunity_id,
      'document_type', new.document_type,
      'fields', to_jsonb(v_changed)
    );

  else -- DELETE
    if not exists (select 1 from public.opportunities o where o.id = old.opportunity_id) then
      return null;
    end if;

    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := old.file_name;
    v_details := jsonb_build_object(
      'parent_type', 'opportunity',
      'parent_id', old.opportunity_id,
      'document_type', old.document_type
    );
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('opportunity_document', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_opportunity_document_activity$;

drop trigger if exists opportunity_documents_log_activity on public.opportunity_documents;
create trigger opportunity_documents_log_activity
  after insert or update or delete on public.opportunity_documents
  for each row
  execute function public.log_opportunity_document_activity();

-- ----------------------------------------------------------------------------
-- 6c. notes: rebuild log_note_activity() to also recognize opportunity_id,
--     and add touch_opportunity_from_note() alongside the existing
--     touch_project_from_note() (014_notes_projects_reminders.sql).
-- ----------------------------------------------------------------------------

create or replace function public.log_note_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_note_activity$
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
    v_summary := coalesce(nullif(btrim(new.title), ''), left(new.content, 80));
    v_details := jsonb_build_object(
      'parent_type',
      case
        when new.project_id is not null then 'project'
        when new.contact_id is not null then 'contact'
        when new.opportunity_id is not null then 'opportunity'
        else null
      end,
      'parent_id', coalesce(new.project_id, new.contact_id, new.opportunity_id),
      'is_reminder', new.is_reminder
    );

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new));

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := coalesce(nullif(btrim(new.title), ''), left(new.content, 80));
    v_details := jsonb_build_object(
      'parent_type',
      case
        when new.project_id is not null then 'project'
        when new.contact_id is not null then 'contact'
        when new.opportunity_id is not null then 'opportunity'
        else null
      end,
      'parent_id', coalesce(new.project_id, new.contact_id, new.opportunity_id),
      'fields', to_jsonb(v_changed)
    );

    if new.reminder_done is distinct from old.reminder_done then
      v_details := v_details || jsonb_build_object('reminder_done', jsonb_build_array(old.reminder_done, new.reminder_done));
    end if;

  else -- DELETE
    if old.project_id is not null and not exists (select 1 from public.projects p where p.id = old.project_id) then
      return null;
    end if;
    if old.contact_id is not null and not exists (select 1 from public.contacts c where c.id = old.contact_id) then
      return null;
    end if;
    if old.opportunity_id is not null and not exists (select 1 from public.opportunities o where o.id = old.opportunity_id) then
      return null;
    end if;

    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := coalesce(nullif(btrim(old.title), ''), left(old.content, 80));
    v_details := jsonb_build_object(
      'parent_type',
      case
        when old.project_id is not null then 'project'
        when old.contact_id is not null then 'contact'
        when old.opportunity_id is not null then 'opportunity'
        else null
      end,
      'parent_id', coalesce(old.project_id, old.contact_id, old.opportunity_id)
    );
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('note', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_note_activity$;

-- Only bumps last_activity_at when the note is (or was) linked to an
-- opportunity — same "contact-linked or unlinked isn't project/
-- opportunity activity" rule touch_project_from_note already applies.
create or replace function public.touch_opportunity_from_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $touch_opportunity_from_note$
begin
  if coalesce(new.opportunity_id, old.opportunity_id) is not null then
    update public.opportunities
       set last_activity_at = now()
     where id = coalesce(new.opportunity_id, old.opportunity_id);
  end if;
  return null;
end;
$touch_opportunity_from_note$;

drop trigger if exists notes_touch_opportunity on public.notes;
create trigger notes_touch_opportunity
  after insert or update or delete on public.notes
  for each row
  execute function public.touch_opportunity_from_note();

revoke all on function public.log_opportunity_activity() from public, anon, authenticated;
revoke all on function public.log_opportunity_document_activity() from public, anon, authenticated;
revoke all on function public.touch_opportunity_from_product() from public, anon, authenticated;
revoke all on function public.touch_opportunity_from_note() from public, anon, authenticated;

commit;

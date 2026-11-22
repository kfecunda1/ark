-- ============================================================================
-- Migration 032: Document checklist "either/or" requirement groups
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 031_spanish.sql have already been applied. Safe to re-run —
-- every statement uses IF EXISTS/IF NOT EXISTS, DROP ... IF EXISTS
-- before CREATE, or ON CONFLICT DO NOTHING.
--
--   1. document_type_groups — an admin-managed named group ("DOA") of
--      document types that satisfy the same checklist requirement
--      interchangeably (Settings → Document checklists' new "Document
--      Groups" area). Same shape as products/document_types/statuses
--      (name unique, optional name_es, active, sort_order) — "hide,
--      never delete" applies here too, so there is deliberately no
--      DELETE policy.
--   2. document_type_group_members — which document_types (by name,
--      ON UPDATE CASCADE — renaming a document type elsewhere keeps
--      its group membership instead of orphaning it) belong to a
--      group. A plain join table, not its own standalone entity —
--      same reasoning product_required_documents itself was never
--      activity-logged.
--   3. product_required_documents gains an alternative form: a
--      requirement row is EITHER a plain document_type OR a group_id,
--      never both and never neither (a check constraint enforces
--      this). document_type is now nullable; the old single `unique
--      (product, document_type)` constraint is replaced by two
--      partial unique indexes (one per form), since a plain UNIQUE
--      constraint would never consider two NULLs equal and so would
--      silently allow duplicate group rows for the same product.
--   4. Seed: a "DOA" group (name_es "DOA") with members "DOA -Not
--      Signed" and "DOA - Signed" (matched by exact existing name —
--      inserted only if a document_type by that exact name already
--      exists, never created here). Every product that currently
--      requires either of those two types individually has that
--      requirement replaced by one requirement on the DOA group
--      instead — done as an INSERT ... SELECT of the old rows
--      *before* deleting them, so no product silently loses its DOA
--      requirement.
--
-- Neither new table gets its own activity_log entity_type — same
-- "a checklist join table, not a standalone entity" reasoning
-- product_required_documents itself already set, per 030_document_
-- checklists.sql. activity_log_entity_type_check is therefore
-- untouched.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. document_type_groups
-- ----------------------------------------------------------------------------

create table if not exists public.document_type_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  name_es text,
  active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.document_type_groups enable row level security;

drop policy if exists "document_type_groups_select_registered" on public.document_type_groups;
create policy "document_type_groups_select_registered"
  on public.document_type_groups for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "document_type_groups_insert_admin" on public.document_type_groups;
create policy "document_type_groups_insert_admin"
  on public.document_type_groups for insert
  to authenticated
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "document_type_groups_update_admin" on public.document_type_groups;
create policy "document_type_groups_update_admin"
  on public.document_type_groups for update
  to authenticated
  using (public.is_registered_user() and public.is_admin())
  with check (public.is_registered_user() and public.is_admin());

-- ----------------------------------------------------------------------------
-- 2. document_type_group_members
-- ----------------------------------------------------------------------------

create table if not exists public.document_type_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.document_type_groups (id) on delete cascade,
  document_type text not null references public.document_types (name) on update cascade,
  created_at timestamptz not null default now(),
  unique (group_id, document_type)
);

alter table public.document_type_group_members enable row level security;

drop policy if exists "document_type_group_members_select_registered" on public.document_type_group_members;
create policy "document_type_group_members_select_registered"
  on public.document_type_group_members for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "document_type_group_members_insert_admin" on public.document_type_group_members;
create policy "document_type_group_members_insert_admin"
  on public.document_type_group_members for insert
  to authenticated
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "document_type_group_members_delete_admin" on public.document_type_group_members;
create policy "document_type_group_members_delete_admin"
  on public.document_type_group_members for delete
  to authenticated
  using (public.is_registered_user() and public.is_admin());

-- ----------------------------------------------------------------------------
-- 3. product_required_documents: document_type OR group_id
-- ----------------------------------------------------------------------------

alter table public.product_required_documents
  alter column document_type drop not null;

alter table public.product_required_documents
  add column if not exists group_id uuid references public.document_type_groups (id);

alter table public.product_required_documents
  drop constraint if exists product_required_documents_product_document_type_key;

alter table public.product_required_documents
  drop constraint if exists product_required_documents_type_xor_group_check;

alter table public.product_required_documents
  add constraint product_required_documents_type_xor_group_check
  check (
    (document_type is not null and group_id is null)
    or (document_type is null and group_id is not null)
  );

drop index if exists product_required_documents_product_type_uniq;
create unique index product_required_documents_product_type_uniq
  on public.product_required_documents (product, document_type)
  where document_type is not null;

drop index if exists product_required_documents_product_group_uniq;
create unique index product_required_documents_product_group_uniq
  on public.product_required_documents (product, group_id)
  where group_id is not null;

-- ----------------------------------------------------------------------------
-- 4. Seed: the "DOA" group, its two members, and the product
--    requirement migration.
-- ----------------------------------------------------------------------------

insert into public.document_type_groups (name, name_es, sort_order)
values ('DOA', 'DOA', 0)
on conflict (name) do nothing;

insert into public.document_type_group_members (group_id, document_type)
select g.id, dt.name
from public.document_type_groups g
join public.document_types dt on dt.name in ('DOA -Not Signed', 'DOA - Signed')
where g.name = 'DOA'
on conflict (group_id, document_type) do nothing;

-- Every product currently requiring either member type individually
-- gets one requirement on the group instead — inserted before the old
-- per-type rows are deleted below, so nothing is lost even if this
-- statement were somehow interrupted between the two.
insert into public.product_required_documents (product, group_id)
select distinct prd.product, g.id
from public.product_required_documents prd
join public.document_type_groups g on g.name = 'DOA'
where prd.document_type in ('DOA -Not Signed', 'DOA - Signed')
on conflict (product, group_id) where group_id is not null do nothing;

delete from public.product_required_documents
where document_type in ('DOA -Not Signed', 'DOA - Signed');

commit;

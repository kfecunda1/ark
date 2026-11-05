-- ============================================================================
-- Migration 013: Projects restructure
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 012_user_management.sql have already been applied.
--
-- Wrapped in BEGIN/COMMIT so the whole thing is all-or-nothing — if
-- anything fails partway, nothing from this file is left applied.
-- Safe to run more than once: every statement uses IF NOT EXISTS /
-- CREATE OR REPLACE / DROP ... IF EXISTS / ON CONFLICT guards.
--
-- Corrected order (this is the fix for a previous run that failed with
-- "violates check constraint activity_log_entity_type_check" — the
-- project_products activity trigger existed, and fired during the data
-- migration, before the constraint had been widened to accept its
-- entity_type):
--
--   1. Widen activity_log_entity_type_check FIRST — every later step
--      that can write an activity_log row (including the data
--      migration) needs the new entity types already accepted.
--   2. Part 1: drop client_contact_id / assigned_contact_id (fully
--      independent of everything else in this file).
--   3. Create project_products (table + RLS only — no triggers yet)
--      and projects.final_product (+ its validate_final_product
--      trigger, which *does* need to exist before the data migration,
--      since the migration's final_product backfill is exactly what
--      it validates). Also recreates log_project_activity() in its
--      fixed, final_product-reading form at this point, rather than
--      at the very end — it no longer touches product_type at all, so
--      doing this before product_type is dropped is harmless, and it
--      means the data migration's own activity_log rows already read
--      correctly instead of needing a second pass.
--   4. Migrate existing data into project_products / final_product.
--      project_products has no activity-log trigger yet at this
--      point, so this one-time backfill doesn't flood activity_log
--      with a "product option added" row per existing project.
--   5. Only now create project_products' own triggers (touch /
--      limit-to-3 / protect-last-one / log-activity) — they only ever
--      see *future* writes, the migration is already done.
--   6. Drop the old product_type column (and its index/FK) last, once
--      nothing above still depends on it.
--
-- What this does
-- --------------
-- PART 1 — removes projects.client_contact_id and
-- projects.assigned_contact_id. "Matched With" (matched_contact_id,
-- untouched) becomes the only contact a project carries. Checked
-- first (per the request): no function or trigger in 001-012
-- references either column — only comments do — so dropping them
-- needs nothing beyond the columns themselves; DROP COLUMN takes
-- their indexes and (unnamed, auto-generated) foreign keys with it
-- automatically, but this drops the indexes explicitly too, for a
-- clear record of what's being removed.
--
-- PART 2 — projects.product_type (a single required enum-backed
-- value) becomes project_products, a 1-3 row table of product options
-- per project, plus projects.final_product (nullable text, FK to
-- products(name), validated against that project's own options by a
-- trigger — Postgres has no way to express "must be a value from a
-- row in another table scoped to this row" as a plain CHECK).
--
-- Two more invariants get a DB-level trigger each, matching this
-- schema's existing belt-and-suspenders style (protect_last_active_
-- admin in 012 is the same idea): a project can never be left with
-- zero product options (protect_last_project_product blocks deleting
-- the last one — but never the cascade from deleting the project
-- itself, which would otherwise become impossible), and never with
-- more than three (limit_project_products blocks a 4th insert). The
-- app enforces 1-3 at the form too, but both ends holding the line
-- means a bug in one can't corrupt data past the other.
--
-- Existing data: every current project's product_type becomes its
-- single project_products row (sort_order 1) and, since a project with
-- exactly one option is automatically final, its final_product too.
-- ============================================================================

begin;

-- ============================================================================
-- 1. Widen activity_log's entity_type check — first, before anything
--    else in this file can possibly write one of these new types.
-- ============================================================================

alter table public.activity_log
  drop constraint if exists activity_log_entity_type_check;

alter table public.activity_log
  add constraint activity_log_entity_type_check
  check (entity_type in (
    'project', 'contact', 'project_document', 'contact_product', 'contact_document',
    'project_step', 'backup', 'password_change', 'product', 'document_type', 'app_settings',
    'user', 'project_product'
  ));


-- ============================================================================
-- PART 1 — drop client_contact_id / assigned_contact_id
-- ============================================================================

drop index if exists public.projects_client_contact_id_idx;
drop index if exists public.projects_assigned_contact_id_idx;

alter table public.projects
  drop column if exists client_contact_id;

alter table public.projects
  drop column if exists assigned_contact_id;


-- ============================================================================
-- PART 2 — project_products + final_product
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2a. project_products table — structure and RLS only. Its own
--     triggers (touch / limit / protect-last / log-activity) are
--     created later, in step 2d, *after* the data migration.
-- ----------------------------------------------------------------------------

create table if not exists public.project_products (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  product text not null references public.products (name) on update cascade,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  unique (project_id, product)
);

create index if not exists project_products_project_id_idx on public.project_products (project_id);

alter table public.project_products enable row level security;

drop policy if exists "project_products_select_registered" on public.project_products;
create policy "project_products_select_registered"
  on public.project_products for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "project_products_insert_registered" on public.project_products;
create policy "project_products_insert_registered"
  on public.project_products for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "project_products_update_registered" on public.project_products;
create policy "project_products_update_registered"
  on public.project_products for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "project_products_delete_registered" on public.project_products;
create policy "project_products_delete_registered"
  on public.project_products for delete
  to authenticated
  using (public.is_registered_user());


-- ----------------------------------------------------------------------------
-- 2b. projects.final_product + its validation trigger.
--
-- Postgres has no way to express "must match a row in another table,
-- scoped to this row's own id" as a plain CHECK constraint, so this is
-- a trigger instead. It must exist *before* the data migration below,
-- since that migration's final_product backfill is exactly what it
-- validates. Only checks when final_product is being set to a
-- non-null value — clearing it (the "Undo choice" action) always
-- passes trivially.
-- ----------------------------------------------------------------------------

alter table public.projects
  add column if not exists final_product text references public.products (name) on update cascade;

create or replace function public.validate_final_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $validate_final_product$
begin
  if new.final_product is not null and not exists (
    select 1 from public.project_products pp
     where pp.project_id = new.id and pp.product = new.final_product
  ) then
    raise exception 'final_product must be one of the project''s own product options.';
  end if;
  return new;
end;
$validate_final_product$;

drop trigger if exists projects_validate_final_product on public.projects;
create trigger projects_validate_final_product
  before insert or update on public.projects
  for each row
  execute function public.validate_final_product();

revoke all on function public.validate_final_product() from public, anon, authenticated;

-- Recreated here (its fixed, final_product-reading form) rather than
-- at the very end of this file, deliberately *before* product_type is
-- dropped and *before* the data migration below: this function's new
-- body never references product_type at all, so redefining it early
-- is harmless, and it means the migration's own activity_log rows
-- (from backfilling final_product) already read correctly the first
-- time, instead of needing a second pass. Same trigger as always
-- (projects_log_activity, created in 001_ark_schema.sql) — CREATE OR
-- REPLACE FUNCTION keeps it attached without recreating it.
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
    v_details := jsonb_build_object('stage', new.stage, 'final_product', new.final_product, 'priority', new.priority);

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
    if new.final_product is distinct from old.final_product then
      v_details := v_details || jsonb_build_object('final_product', jsonb_build_array(old.final_product, new.final_product));
    end if;
    if (new.archived_at is not null) is distinct from (old.archived_at is not null) then
      v_details := v_details || jsonb_build_object('archived', jsonb_build_array(old.archived_at is not null, new.archived_at is not null));
    end if;

  else -- DELETE
    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := old.name;
    v_details := jsonb_build_object('stage', old.stage, 'final_product', old.final_product);
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('project', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_project_activity$;


-- ----------------------------------------------------------------------------
-- 2c. Migrate existing data — project_products has no activity-log
--     trigger yet (that's step 2d, next), so this doesn't write one
--     activity_log row per pre-existing project.
--
--     Order matters within this step too: the INSERT must run before
--     the UPDATE, since validate_final_product (created above) checks
--     final_product against project_products — which, for an existing
--     project, has no matching row until this INSERT creates one.
-- ----------------------------------------------------------------------------

insert into public.project_products (project_id, product, sort_order)
select id, product_type, 1
  from public.projects
 where product_type is not null
on conflict (project_id, product) do nothing;

update public.projects
   set final_product = product_type
 where product_type is not null
   and final_product is distinct from product_type;


-- ----------------------------------------------------------------------------
-- 2d. project_products' own triggers — created now, *after* the data
--     migration above, so they only ever see future writes.
-- ----------------------------------------------------------------------------

-- Same reasoning as project_tranches_touch_project (001_ark_schema.sql):
-- adding, removing, or reordering a project's product options is real
-- project activity, so it should move last_activity_at too.
create or replace function public.touch_project_from_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $touch_project_from_product$
begin
  update public.projects
     set last_activity_at = now()
   where id = coalesce(new.project_id, old.project_id);
  return null;
end;
$touch_project_from_product$;

drop trigger if exists project_products_touch_project on public.project_products;
create trigger project_products_touch_project
  after insert or update or delete on public.project_products
  for each row
  execute function public.touch_project_from_product();

-- Never fires through the app (no UI ever inserts a 4th option — the
-- form caps at 3), but closes the door at the data layer too.
create or replace function public.limit_project_products()
returns trigger
language plpgsql
security definer
set search_path = public
as $limit_project_products$
declare
  v_count integer;
begin
  select count(*) into v_count from public.project_products where project_id = new.project_id;
  if v_count >= 3 then
    raise exception 'A project can have at most 3 product options.';
  end if;
  return new;
end;
$limit_project_products$;

drop trigger if exists project_products_limit on public.project_products;
create trigger project_products_limit
  before insert on public.project_products
  for each row
  execute function public.limit_project_products();

-- Mirrors protect_last_active_admin's shape (012_user_management.sql):
-- refuses to remove a project's last remaining product option,
-- regardless of who's asking — but only while the project itself
-- still exists. Deleting a project cascades to delete all of its
-- project_products rows one at a time; without this guard, that
-- cascade would be blocked on its very last row (no *other* option is
-- ever left at that point) and a project with any options would
-- become un-deletable.
create or replace function public.protect_last_project_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $protect_last_project_product$
begin
  if not exists (select 1 from public.projects p where p.id = old.project_id) then
    return old;
  end if;

  if not exists (
    select 1 from public.project_products pp
     where pp.project_id = old.project_id and pp.id <> old.id
  ) then
    raise exception 'A project must keep at least one product option.';
  end if;
  return old;
end;
$protect_last_project_product$;

drop trigger if exists project_products_protect_last on public.project_products;
create trigger project_products_protect_last
  before delete on public.project_products
  for each row
  execute function public.protect_last_project_product();

-- Activity log — same shape and the same cascade guard as
-- log_contact_product_activity (003_contacts_upgrade.sql): a DELETE
-- whose parent project is already gone is the cascade from deleting
-- the project, not an option someone removed on purpose.
create or replace function public.log_project_product_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_project_product_activity$
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
    v_summary := new.product;
    v_details := jsonb_build_object('parent_type', 'project', 'parent_id', new.project_id, 'product', new.product);

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new), array['created_at']);

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := new.product;
    v_details := jsonb_build_object(
      'parent_type', 'project',
      'parent_id', new.project_id,
      'product', new.product,
      'fields', to_jsonb(v_changed)
    );

  else -- DELETE
    if not exists (select 1 from public.projects p where p.id = old.project_id) then
      return null;
    end if;

    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := old.product;
    v_details := jsonb_build_object('parent_type', 'project', 'parent_id', old.project_id, 'product', old.product);
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('project_product', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_project_product_activity$;

drop trigger if exists project_products_log_activity on public.project_products;
create trigger project_products_log_activity
  after insert or update or delete on public.project_products
  for each row
  execute function public.log_project_product_activity();

revoke all on function public.touch_project_from_product() from public, anon, authenticated;
revoke all on function public.limit_project_products() from public, anon, authenticated;
revoke all on function public.protect_last_project_product() from public, anon, authenticated;
revoke all on function public.log_project_product_activity() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2e. Drop the old product_type column — last, once nothing above
--     still depends on it.
-- ----------------------------------------------------------------------------

drop index if exists public.projects_product_type_idx;

alter table public.projects
  drop constraint if exists projects_product_type_fkey;

alter table public.projects
  drop column if exists product_type;

commit;

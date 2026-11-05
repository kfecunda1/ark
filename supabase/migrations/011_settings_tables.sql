-- ============================================================================
-- Migration 011: Settings — products, document types, defaults, profile
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 010_add_ktk.sql have already been applied. Mostly safe to
-- re-run (CREATE OR REPLACE / DROP ... IF EXISTS / ON CONFLICT guards
-- throughout) — the one exception is the two enum-to-text column
-- conversions in section 6, which become no-ops the second time
-- (the column is already text by then, and `text::text` is a valid
-- cast), and the two `drop type` statements, which use IF EXISTS.
--
-- What this does
-- --------------
-- 1. products table — admin-managed, replaces the fixed product_type
--    enum. projects.product_type and contact_products.product_type
--    become plain text columns with a foreign key to products(name)
--    ON UPDATE CASCADE, so renaming a product (section 1 of the app
--    work) updates every row that references it automatically. The old
--    product_type enum is then dropped — confirmed below that nothing
--    else in the schema has a hard dependency on it (no function
--    parameter or explicit `::product_type` cast anywhere; the trigger
--    functions that read `new.product_type` do so dynamically through
--    the row, and 003_contacts_upgrade.sql's `new.product_type::text`
--    cast targets the column's *new* type, not the old enum).
-- 2. document_types table — same shape and same conversion, for
--    project_documents.document_type and contact_documents.document_type
--    (both of which shared the one project_document_type enum).
-- 3. app_settings — a single-row settings table (default_currency,
--    stuck_after_days). The `id boolean primary key check (id)` trick
--    makes a second row physically impossible: id can only be true
--    (the check forbids false), and primary key uniqueness forbids a
--    second `true` row.
-- 4. is_admin() — SECURITY DEFINER, same shape as is_registered_user()
--    and (like it) left with its default PUBLIC execute grant rather
--    than revoked, since RLS policies call it as whatever role is
--    making the request.
-- 5. profiles: a BEFORE UPDATE trigger blocks a non-admin from changing
--    their own (or anyone else's) role through an UPDATE — the
--    existing profiles_update_self policy already confines a user to
--    their own row, but row-level policies alone can't restrict which
--    *columns* an allowed UPDATE touches, so a non-admin changing their
--    full_name must not be able to smuggle a role change into the same
--    request.
-- 6. Activity log entries for products, document_types and app_settings,
--    via three new trigger functions following the exact shape of
--    log_contact_product_activity() etc. Widens the entity_type check
--    accordingly.
-- ============================================================================


-- ============================================================================
-- 1. products
-- ============================================================================

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products enable row level security;

insert into public.products (name, sort_order) values
  ('SBLC', 1),
  ('MX103', 2),
  ('MT103', 3),
  ('IP-IP', 4),
  ('API', 5),
  ('API Cash', 6),
  ('T2T', 7),
  ('S2S', 8),
  ('VISA', 9),
  ('GPI', 10),
  ('KTK', 11)
on conflict (name) do nothing;


-- ============================================================================
-- 2. document_types
-- ============================================================================

create table if not exists public.document_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.document_types enable row level security;

insert into public.document_types (name, sort_order) values
  ('CIS', 1),
  ('POF', 2),
  ('DOA', 3),
  ('PGL', 4),
  ('JSON', 5),
  ('Proof of Fulfillment', 6),
  ('Supporting Documents', 7),
  ('Additional Documents', 8)
on conflict (name) do nothing;


-- ============================================================================
-- 3. app_settings (singleton)
-- ============================================================================

create table if not exists public.app_settings (
  id boolean primary key default true,
  default_currency text not null default 'USD' check (default_currency in ('USD', 'EUR')),
  stuck_after_days integer not null default 7 check (stuck_after_days > 0),
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id)
);

alter table public.app_settings enable row level security;

insert into public.app_settings (id) values (true)
on conflict (id) do nothing;


-- ============================================================================
-- 4. is_admin()
-- ============================================================================

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $is_admin$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  );
$is_admin$;


-- ============================================================================
-- RLS: products, document_types, app_settings
--
-- Every registered user can read all three; only an admin can write.
-- No DELETE policy on any of the three — products and document types
-- are hidden with active = false instead of removed, and app_settings'
-- single row must never be removable at all.
-- ============================================================================

drop policy if exists "products_select_registered" on public.products;
create policy "products_select_registered"
  on public.products for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "products_insert_admin" on public.products;
create policy "products_insert_admin"
  on public.products for insert
  to authenticated
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "products_update_admin" on public.products;
create policy "products_update_admin"
  on public.products for update
  to authenticated
  using (public.is_registered_user() and public.is_admin())
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "document_types_select_registered" on public.document_types;
create policy "document_types_select_registered"
  on public.document_types for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "document_types_insert_admin" on public.document_types;
create policy "document_types_insert_admin"
  on public.document_types for insert
  to authenticated
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "document_types_update_admin" on public.document_types;
create policy "document_types_update_admin"
  on public.document_types for update
  to authenticated
  using (public.is_registered_user() and public.is_admin())
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "app_settings_select_registered" on public.app_settings;
create policy "app_settings_select_registered"
  on public.app_settings for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "app_settings_update_admin" on public.app_settings;
create policy "app_settings_update_admin"
  on public.app_settings for update
  to authenticated
  using (public.is_registered_user() and public.is_admin())
  with check (public.is_registered_user() and public.is_admin());

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row
  execute function public.set_updated_at_only();

drop trigger if exists document_types_set_updated_at on public.document_types;
create trigger document_types_set_updated_at
  before update on public.document_types
  for each row
  execute function public.set_updated_at_only();

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row
  execute function public.set_updated_at_only();


-- ============================================================================
-- 1 (cont'd). projects.product_type / contact_products.product_type:
--    enum -> text + FK to products(name) ON UPDATE CASCADE
-- ============================================================================

alter table public.projects
  alter column product_type type text using product_type::text;

alter table public.projects
  drop constraint if exists projects_product_type_fkey;

alter table public.projects
  add constraint projects_product_type_fkey
  foreign key (product_type) references public.products (name)
  on update cascade;

alter table public.contact_products
  alter column product_type type text using product_type::text;

alter table public.contact_products
  drop constraint if exists contact_products_product_type_fkey;

alter table public.contact_products
  add constraint contact_products_product_type_fkey
  foreign key (product_type) references public.products (name)
  on update cascade;

drop type if exists public.product_type;


-- ============================================================================
-- 2 (cont'd). project_documents.document_type / contact_documents.document_type:
--    enum -> text + FK to document_types(name) ON UPDATE CASCADE
-- ============================================================================

alter table public.project_documents
  alter column document_type type text using document_type::text;

alter table public.project_documents
  drop constraint if exists project_documents_document_type_fkey;

alter table public.project_documents
  add constraint project_documents_document_type_fkey
  foreign key (document_type) references public.document_types (name)
  on update cascade;

alter table public.contact_documents
  alter column document_type type text using document_type::text;

alter table public.contact_documents
  drop constraint if exists contact_documents_document_type_fkey;

alter table public.contact_documents
  add constraint contact_documents_document_type_fkey
  foreign key (document_type) references public.document_types (name)
  on update cascade;

drop type if exists public.project_document_type;


-- ============================================================================
-- 5. profiles: block non-admins from changing role via UPDATE
-- ============================================================================

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $protect_profile_role$
begin
  -- auth.uid() is null for direct SQL (the Supabase SQL editor, a
  -- maintenance script run with the service role, …) — only a real
  -- end-user session making this change through the app is subject to
  -- the restriction below; a trigger fires regardless of who's running
  -- the statement, so without this guard, even the user's own migration
  -- 006-style "promote this user to admin" SQL would be blocked.
  if auth.uid() is not null and new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only an admin can change a profile role.';
  end if;
  return new;
end;
$protect_profile_role$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before update on public.profiles
  for each row
  execute function public.protect_profile_role();


-- ============================================================================
-- 6. Activity log: products, document_types, app_settings
-- ============================================================================

alter table public.activity_log
  drop constraint if exists activity_log_entity_type_check;

alter table public.activity_log
  add constraint activity_log_entity_type_check
  check (entity_type in (
    'project', 'contact', 'project_document', 'contact_product', 'contact_document',
    'project_step', 'backup', 'password_change', 'product', 'document_type', 'app_settings'
  ));

create or replace function public.log_product_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_product_activity$
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
    v_details := jsonb_build_object('active', new.active, 'sort_order', new.sort_order);

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
  values ('product', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_product_activity$;

drop trigger if exists products_log_activity on public.products;
create trigger products_log_activity
  after insert or update or delete on public.products
  for each row
  execute function public.log_product_activity();

create or replace function public.log_document_type_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_document_type_activity$
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
    v_details := jsonb_build_object('active', new.active, 'sort_order', new.sort_order);

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
  values ('document_type', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_document_type_activity$;

drop trigger if exists document_types_log_activity on public.document_types;
create trigger document_types_log_activity
  after insert or update or delete on public.document_types
  for each row
  execute function public.log_document_type_activity();

-- app_settings is a singleton with no natural per-row id, so its
-- activity_log entity_id is pinned to this fixed, made-up uuid rather
-- than a real row id — there is, and only ever will be, one such row.
create or replace function public.log_app_settings_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_app_settings_activity$
declare
  v_actor_id uuid;
  v_actor_label text;
  v_action text;
  v_details jsonb;
  v_changed text[];
  v_entity_id constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  if tg_op = 'INSERT' then
    v_action := 'created';
    v_details := jsonb_build_object('default_currency', new.default_currency, 'stuck_after_days', new.stuck_after_days);

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new), array['updated_at']);

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_action := 'updated';
    v_details := jsonb_build_object('fields', to_jsonb(v_changed));

    if new.default_currency is distinct from old.default_currency then
      v_details := v_details || jsonb_build_object(
        'default_currency', jsonb_build_array(old.default_currency, new.default_currency)
      );
    end if;
    if new.stuck_after_days is distinct from old.stuck_after_days then
      v_details := v_details || jsonb_build_object(
        'stuck_after_days', jsonb_build_array(old.stuck_after_days, new.stuck_after_days)
      );
    end if;

  else -- DELETE: never happens (no DELETE policy, singleton row), guarded anyway
    v_action := 'deleted';
    v_details := '{}'::jsonb;
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('app_settings', v_entity_id, v_action, 'Settings', v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_app_settings_activity$;

drop trigger if exists app_settings_log_activity on public.app_settings;
create trigger app_settings_log_activity
  after insert or update or delete on public.app_settings
  for each row
  execute function public.log_app_settings_activity();

revoke all on function public.log_product_activity() from public, anon, authenticated;
revoke all on function public.log_document_type_activity() from public, anon, authenticated;
revoke all on function public.log_app_settings_activity() from public, anon, authenticated;

-- ============================================================================
-- JES3 CRM schema
--
-- Run this manually in the Supabase SQL editor. Safe to re-run: statements
-- use IF NOT EXISTS / DROP ... IF EXISTS guards where practical.
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
  if not exists (select 1 from pg_type where typname = 'business_line') then
    create type business_line as enum ('crypto', 'gold', 'pgm');
  end if;

  if not exists (select 1 from pg_type where typname = 'lead_priority') then
    create type lead_priority as enum ('low', 'medium', 'high', 'urgent');
  end if;

  if not exists (select 1 from pg_type where typname = 'lead_stage') then
    create type lead_stage as enum ('new', 'in_progress', 'closed_won', 'closed_lost');
  end if;

  if not exists (select 1 from pg_type where typname = 'procedure_source') then
    create type procedure_source as enum ('whatsapp', 'telegram', 'document', 'link');
  end if;

  if not exists (select 1 from pg_type where typname = 'procedure_status') then
    create type procedure_status as enum ('unmatched', 'matched', 'archived');
  end if;
end $$;


-- ============================================================================
-- Tables
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  role text
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  business_line business_line not null,
  product_type text not null,
  procedure_type text not null,
  cis text not null,
  wallet_address text,
  priority lead_priority not null default 'medium',
  stage lead_stage not null default 'new',
  stage_updated_at timestamptz not null default now(),
  contact_name text not null,
  contact_info text not null,
  counterparty_name text,
  deal_value numeric,
  currency text,
  source text,
  notes text,
  follow_up_date date,
  assigned_to uuid references public.profiles (id)
);

create table if not exists public.procedures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source procedure_source not null,
  raw_content text not null,
  area business_line not null,
  status procedure_status not null default 'unmatched',
  matched_lead_id uuid references public.leads (id),
  document_path text
);

create index if not exists leads_assigned_to_idx on public.leads (assigned_to);
create index if not exists leads_stage_idx on public.leads (stage);
create index if not exists procedures_matched_lead_id_idx on public.procedures (matched_lead_id);
create index if not exists procedures_status_idx on public.procedures (status);


-- ============================================================================
-- Triggers: updated_at / stage_updated_at on leads
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_stage_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row
  execute function public.set_updated_at();

drop trigger if exists leads_set_stage_updated_at on public.leads;
create trigger leads_set_stage_updated_at
  before update on public.leads
  for each row
  execute function public.set_stage_updated_at();


-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.leads enable row level security;
alter table public.procedures enable row level security;

-- Helper: does the current authenticated user have a profiles row?
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

-- profiles: a user can see and manage their own profile; any registered
-- user can look up other profiles (needed to resolve leads.assigned_to).
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

-- leads: full access for any authenticated user with a profiles row.
drop policy if exists "leads_select_registered" on public.leads;
create policy "leads_select_registered"
  on public.leads for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "leads_insert_registered" on public.leads;
create policy "leads_insert_registered"
  on public.leads for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "leads_update_registered" on public.leads;
create policy "leads_update_registered"
  on public.leads for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "leads_delete_registered" on public.leads;
create policy "leads_delete_registered"
  on public.leads for delete
  to authenticated
  using (public.is_registered_user());

-- procedures: full access for any authenticated user with a profiles row.
drop policy if exists "procedures_select_registered" on public.procedures;
create policy "procedures_select_registered"
  on public.procedures for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "procedures_insert_registered" on public.procedures;
create policy "procedures_insert_registered"
  on public.procedures for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "procedures_update_registered" on public.procedures;
create policy "procedures_update_registered"
  on public.procedures for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "procedures_delete_registered" on public.procedures;
create policy "procedures_delete_registered"
  on public.procedures for delete
  to authenticated
  using (public.is_registered_user());


-- ============================================================================
-- Storage: private bucket for procedure documents
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('procedure-documents', 'procedure-documents', false)
on conflict (id) do nothing;

drop policy if exists "procedure_documents_select_registered" on storage.objects;
create policy "procedure_documents_select_registered"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'procedure-documents'
    and public.is_registered_user()
  );

drop policy if exists "procedure_documents_insert_registered" on storage.objects;
create policy "procedure_documents_insert_registered"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'procedure-documents'
    and public.is_registered_user()
  );

drop policy if exists "procedure_documents_update_registered" on storage.objects;
create policy "procedure_documents_update_registered"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'procedure-documents'
    and public.is_registered_user()
  )
  with check (
    bucket_id = 'procedure-documents'
    and public.is_registered_user()
  );

drop policy if exists "procedure_documents_delete_registered" on storage.objects;
create policy "procedure_documents_delete_registered"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'procedure-documents'
    and public.is_registered_user()
  );

-- ============================================================================
-- Migration 012: Contact capabilities
--
-- Adds repeatable capability tags to contacts (e.g. "Oil - EN590",
-- "BTC - Face to Face Dubai"), plus a free-text notes column for detail
-- that doesn't fit a short tag. Run this manually in the Supabase SQL
-- editor, after 001-011 have already been applied. Safe to re-run.
--
-- contact_id uses ON DELETE CASCADE: a capability row only makes sense
-- attached to its contact, so deleting a contact should not leave
-- orphaned capability rows behind.
-- ============================================================================

create table if not exists public.contact_capabilities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  tag text not null,
  created_at timestamptz not null default now()
);

create index if not exists contact_capabilities_contact_id_idx on public.contact_capabilities (contact_id);


-- ============================================================================
-- Row Level Security (same "registered user" pattern as other tables)
-- ============================================================================

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
-- Free-text capability detail on the contact itself
-- ============================================================================

alter table public.contacts
  add column if not exists notes text;

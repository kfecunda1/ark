-- ============================================================================
-- Migration 005: Lead documents
--
-- Replaces the free-text `cis` field on leads with real file attachments.
-- Run this manually in the Supabase SQL editor, after 001-004 have already
-- been applied.
--
-- The table/policy/bucket statements are safe to re-run (IF NOT EXISTS /
-- DROP ... IF EXISTS guards, same as prior migrations). The `cis` column
-- drop at the bottom is not re-runnable once applied (the column will
-- already be gone) — that's fine here since the data was already wiped.
--
-- lead_id uses ON DELETE CASCADE: a lead_documents row only makes sense
-- attached to its lead, so deleting a lead should not leave orphaned
-- metadata rows behind. Note this only cleans up the database row —
-- the underlying Storage object is a separate system and is NOT removed
-- by this cascade, so any app code that deletes a lead should still
-- explicitly delete that lead's Storage objects first.
-- ============================================================================


-- ============================================================================
-- Table
-- ============================================================================

create table if not exists public.lead_documents (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  document_type text not null check (document_type in ('CIS', 'Other')),
  file_path text not null,
  file_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists lead_documents_lead_id_idx on public.lead_documents (lead_id);


-- ============================================================================
-- Row Level Security (same "registered user" pattern as other tables)
-- ============================================================================

alter table public.lead_documents enable row level security;

drop policy if exists "lead_documents_select_registered" on public.lead_documents;
create policy "lead_documents_select_registered"
  on public.lead_documents for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "lead_documents_insert_registered" on public.lead_documents;
create policy "lead_documents_insert_registered"
  on public.lead_documents for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "lead_documents_update_registered" on public.lead_documents;
create policy "lead_documents_update_registered"
  on public.lead_documents for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "lead_documents_delete_registered" on public.lead_documents;
create policy "lead_documents_delete_registered"
  on public.lead_documents for delete
  to authenticated
  using (public.is_registered_user());


-- ============================================================================
-- Storage: private bucket for lead documents (same pattern as
-- procedure-documents)
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('lead-documents', 'lead-documents', false)
on conflict (id) do nothing;

drop policy if exists "lead_documents_bucket_select_registered" on storage.objects;
create policy "lead_documents_bucket_select_registered"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'lead-documents'
    and public.is_registered_user()
  );

drop policy if exists "lead_documents_bucket_insert_registered" on storage.objects;
create policy "lead_documents_bucket_insert_registered"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'lead-documents'
    and public.is_registered_user()
  );

drop policy if exists "lead_documents_bucket_update_registered" on storage.objects;
create policy "lead_documents_bucket_update_registered"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'lead-documents'
    and public.is_registered_user()
  )
  with check (
    bucket_id = 'lead-documents'
    and public.is_registered_user()
  );

drop policy if exists "lead_documents_bucket_delete_registered" on storage.objects;
create policy "lead_documents_bucket_delete_registered"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'lead-documents'
    and public.is_registered_user()
  );


-- ============================================================================
-- Drop the old free-text cis column (data already wiped, no migration
-- needed)
-- ============================================================================

alter table public.leads
  drop column if exists cis;

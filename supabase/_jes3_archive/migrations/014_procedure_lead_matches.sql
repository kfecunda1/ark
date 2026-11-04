-- ============================================================================
-- Migration 014: Procedure <-> Lead many-to-many matching
--
-- Replaces the single matched_lead_id column on procedures with a join
-- table, so a procedure can be matched to more than one lead (and a lead
-- to more than one procedure). Run this manually in the Supabase SQL
-- editor, after 001-013 have already been applied.
--
-- The table/policy/index statements are safe to re-run (IF NOT EXISTS /
-- DROP ... IF EXISTS guards). The data migration and column drop at the
-- bottom are NOT safe to re-run once applied: the second run would find
-- matched_lead_id already dropped and error out. Review before re-running.
-- ============================================================================

create table if not exists public.procedure_lead_matches (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (procedure_id, lead_id)
);

create index if not exists procedure_lead_matches_procedure_id_idx on public.procedure_lead_matches (procedure_id);
create index if not exists procedure_lead_matches_lead_id_idx on public.procedure_lead_matches (lead_id);


-- ============================================================================
-- Row Level Security (same "registered user" pattern as other tables)
-- ============================================================================

alter table public.procedure_lead_matches enable row level security;

drop policy if exists "procedure_lead_matches_select_registered" on public.procedure_lead_matches;
create policy "procedure_lead_matches_select_registered"
  on public.procedure_lead_matches for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "procedure_lead_matches_insert_registered" on public.procedure_lead_matches;
create policy "procedure_lead_matches_insert_registered"
  on public.procedure_lead_matches for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "procedure_lead_matches_update_registered" on public.procedure_lead_matches;
create policy "procedure_lead_matches_update_registered"
  on public.procedure_lead_matches for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "procedure_lead_matches_delete_registered" on public.procedure_lead_matches;
create policy "procedure_lead_matches_delete_registered"
  on public.procedure_lead_matches for delete
  to authenticated
  using (public.is_registered_user());


-- ============================================================================
-- Data migration: matched_lead_id -> procedure_lead_matches
-- ============================================================================

insert into public.procedure_lead_matches (procedure_id, lead_id)
select id, matched_lead_id
from public.procedures
where matched_lead_id is not null
on conflict (procedure_id, lead_id) do nothing;


-- ============================================================================
-- Drop the old single-match column now that every match has been migrated
-- ============================================================================

drop index if exists procedures_matched_lead_id_idx;

alter table public.procedures
  drop column if exists matched_lead_id;

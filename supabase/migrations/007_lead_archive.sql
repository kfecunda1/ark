-- ============================================================================
-- Migration 007: Lead archive
--
-- Adds a boolean archived flag to leads, defaulting existing rows to false
-- (i.e. active). Archived leads are excluded from the default Leads list
-- and from Dashboard stats/panels, but remain in the database and can be
-- viewed via the "show archived" filter. Run this manually in the
-- Supabase SQL editor, after 001-006 have already been applied. Safe to
-- re-run.
-- ============================================================================

alter table public.leads
  add column if not exists archived boolean not null default false;

create index if not exists leads_archived_idx on public.leads (archived);

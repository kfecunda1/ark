-- ============================================================================
-- Migration 006: Procedure title
--
-- Adds an optional title to procedures, used as the prominent label in the
-- Procedures list/detail views (falling back to the raw_content preview
-- when unset) and as a search target alongside raw_content. Run this
-- manually in the Supabase SQL editor, after 001-005 have already been
-- applied. Safe to re-run.
-- ============================================================================

alter table public.procedures
  add column if not exists title text;

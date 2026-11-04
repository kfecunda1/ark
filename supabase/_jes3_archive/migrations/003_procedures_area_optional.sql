-- ============================================================================
-- Migration 003: Make procedures.area optional
--
-- Drops the NOT NULL constraint on public.procedures.area. Everything else
-- about the table is unchanged. Run this manually in the Supabase SQL
-- editor, after 001 (schema.sql) and 002 (contacts.sql) have already been
-- applied. Safe to re-run.
-- ============================================================================

alter table public.procedures
  alter column area drop not null;

-- ============================================================================
-- Migration 015: Flag procedures intended as leads
--
-- Adds a nullable boolean intended_as_lead column to public.procedures,
-- defaulting to false. Set by the Telegram webhook when an incoming
-- message (or a message it merges into) starts with "/lead", and used to
-- surface a "Convert to Lead" action in the UI. Run this manually in the
-- Supabase SQL editor, after 001-014 have already been applied. Safe to
-- re-run.
-- ============================================================================

alter table public.procedures
  add column if not exists intended_as_lead boolean default false;

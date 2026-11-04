-- ============================================================================
-- Migration 002: Currency check constraint
--
-- projects.currency was free text (constrained only in the app's UI,
-- which is now a USD/EUR dropdown — see components/projects/project-
-- form.tsx and lib/projects.ts's CURRENCIES list). This adds the same
-- constraint at the database level, so it holds regardless of what
-- writes the row.
--
-- Run this manually in the Supabase SQL editor, after
-- 001_ark_schema.sql has already been applied. Safe to re-run: the
-- constraint is dropped and re-added, and this will only ever error if
-- some existing row already holds a currency other than USD or EUR —
-- in which case fix that row first (there is no data to migrate on a
-- brand-new schema, but this guards against hand-edited rows).
-- ============================================================================

alter table public.projects
  drop constraint if exists projects_currency_check;

alter table public.projects
  add constraint projects_currency_check
  check (currency in ('USD', 'EUR'));

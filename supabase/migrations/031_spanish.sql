-- ============================================================================
-- Migration 031: Spanish as a per-user interface language
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 030_document_checklists.sql have already been applied. Safe
-- to re-run — every statement uses IF EXISTS/IF NOT EXISTS or DROP ...
-- IF EXISTS before CREATE.
--
--   1. profiles.language ('en' | 'es', default 'en') — Settings → My
--      Profile's own "Language / Idioma" selector. A personal
--      preference, same spirit as telegram_user_id/briefing_enabled on
--      this same table: never activity-logged.
--   2. statuses.name_es / document_types.name_es (nullable text) — the
--      optional Spanish display name admins can set per catalog item
--      (Settings → Statuses / Document Types). Products deliberately
--      get no such column: product codes (SBLC, MT103, …) stay the
--      same in every language. Renaming the English name already
--      cascades via each table's own ON UPDATE CASCADE FK from
--      project_documents.document_type etc.; name_es is never an FK
--      target itself (nothing references it), so it needs no cascade
--      of its own.
--
-- No new activity_log entity_type is introduced by either change, so
-- activity_log_entity_type_check is untouched. log_catalog_item_
-- activity() (wherever products/document_types/statuses already
-- report a generic "fields changed" list) already diffs *every*
-- changed column generically, so a name_es edit is picked up there
-- with no trigger change needed — same reasoning 015_recovery.sql's
-- own comment gives for recovery_ratio needing none either.
-- ============================================================================

begin;

alter table public.profiles
  add column if not exists language text not null default 'en';

alter table public.profiles
  drop constraint if exists profiles_language_check;

alter table public.profiles
  add constraint profiles_language_check check (language in ('en', 'es'));

alter table public.statuses
  add column if not exists name_es text;

alter table public.document_types
  add column if not exists name_es text;

commit;

-- ============================================================================
-- Migration 027: Inbox redesign — filed-item metadata
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 026_delete_project.sql have already been applied. Safe to
-- re-run — every statement uses ADD COLUMN IF NOT EXISTS.
--
--   The redesigned Inbox's "Filed" tab needs to show who filed an item,
--   when, and a link straight to the document it became — none of
--   which inbox_items (022_telegram_inbox.sql) tracked before now:
--
--   - filed_by: the registered user who actually filed it (not
--     profile_id, which is who *sent* the Telegram message). ON DELETE
--     SET NULL rather than losing the row if that user is later
--     removed — same reasoning as inbox_items.profile_id already uses.
--   - filed_at: when filing happened — distinct from received_at
--     (when the Telegram message arrived).
--   - filed_document_id: the project_documents/contact_documents row
--     this item became, when it was filed as a Document (null when
--     filed as a Note, or not filed at all) — which table to look it
--     up in is implied by filed_to_type, same reasoning filed_to_id
--     already has no single FK of its own.
--
--   Note: the separate "too large for Telegram" bug fix (the warning
--   was showing on *every* filed item, since it was inferred from
--   storage_path being null — which filing itself also sets, having
--   nothing to do with file size) needed no schema change at all:
--   inbox_items.file_size was already populated reliably and untouched
--   by filing, so the app now checks that directly instead.
-- ============================================================================

begin;

alter table public.inbox_items
  add column if not exists filed_by uuid references public.profiles (id) on delete set null;

alter table public.inbox_items
  add column if not exists filed_at timestamptz;

alter table public.inbox_items
  add column if not exists filed_document_id uuid;

commit;

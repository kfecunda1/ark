-- ============================================================================
-- Migration 004: Telegram chat id on procedures
--
-- Adds a nullable telegram_chat_id column so the webhook can recognize
-- multiple Telegram messages (e.g. a caption-less photo followed by a
-- separate text message) as parts of the same incoming procedure and merge
-- them instead of creating duplicate rows. Run this manually in the
-- Supabase SQL editor, after 001/002/003 have already been applied. Safe
-- to re-run.
--
-- bigint (not int4) because Telegram chat ids for supergroups/channels are
-- large negative numbers that can exceed int4's range.
-- ============================================================================

alter table public.procedures
  add column if not exists telegram_chat_id bigint;

create index if not exists procedures_telegram_chat_id_idx on public.procedures (telegram_chat_id);

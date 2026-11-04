-- ============================================================================
-- Migration 018: Wallet labels
--
-- Adds an optional label to procedure_wallets and lead_wallets (e.g.
-- "Seller BTC Wallet 1"), so a wallet's purpose can be noted without
-- parsing the address itself. Output-only: no existing columns change,
-- existing rows get label = null. Run this manually in the Supabase SQL
-- editor, after 001-017 have already been applied. Safe to re-run.
-- ============================================================================

alter table public.procedure_wallets
  add column if not exists label text;

alter table public.lead_wallets
  add column if not exists label text;

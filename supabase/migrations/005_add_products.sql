-- ============================================================================
-- Migration 005: Add VISA and API Cash products
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql,
-- 002_currency_check.sql, 003_contacts_upgrade.sql and 004_timeline.sql
-- have already been applied. Safe to re-run: ADD VALUE IF NOT EXISTS is a
-- no-op once the value already exists.
--
-- public.product_type is shared by projects.product_type and
-- contact_products.product_type (see 001_ark_schema.sql), so adding a
-- value here makes it available to both. Kept in sync by hand with
-- lib/products.ts's PRODUCT_TYPES list and lib/types.ts's ProductType.
--
-- Note: ALTER TYPE ... ADD VALUE cannot run inside the same transaction
-- block as other statements that use the new value, but this migration
-- only adds values — nothing else in this file reads or writes them —
-- so running it as a single plain script (not wrapped in an explicit
-- BEGIN/COMMIT) is safe.
-- ============================================================================

alter type public.product_type add value if not exists 'VISA';
alter type public.product_type add value if not exists 'API Cash';

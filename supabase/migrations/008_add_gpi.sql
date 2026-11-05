-- ============================================================================
-- Migration 008: Add GPI product
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 007_backup_log.sql have already been applied. Safe to re-run:
-- ADD VALUE IF NOT EXISTS is a no-op once the value already exists.
--
-- public.product_type is shared by projects.product_type and
-- contact_products.product_type (see 001_ark_schema.sql), so adding a
-- value here makes it available to both. Kept in sync by hand with
-- lib/products.ts's PRODUCT_TYPES list and lib/types.ts's ProductType.
--
-- Note: ALTER TYPE ... ADD VALUE cannot run inside the same transaction
-- block as other statements that use the new value, but this migration
-- only adds a value — nothing else in this file reads or writes it — so
-- running it as a single plain script (not wrapped in an explicit
-- BEGIN/COMMIT) is safe.
-- ============================================================================

alter type public.product_type add value if not exists 'GPI';

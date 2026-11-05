-- ============================================================================
-- Migration 006: Admin role
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 005_add_products.sql have already been applied. Safe to
-- re-run: the constraint is dropped and re-added, and the role update
-- is a plain idempotent UPDATE.
--
-- profiles.role has existed since 001_ark_schema.sql as a plain,
-- unconstrained text column (every row created so far has it null — see
-- app/login/page.tsx's first-login ensureProfile, which always inserts
-- role: null). This adds a CHECK constraint so it only ever holds
-- 'admin' or 'member' (or null, for a user not yet assigned either),
-- then promotes one specific user to 'admin'.
--
-- 'admin' gates the Settings page's "Export everything" backup button
-- (see 007_backup_log.sql) and the matching "Last backup" indicator on
-- the Dashboard — both are UI-level checks against this column, read
-- the normal way through the existing is_registered_user()-gated RLS
-- policies (no new policy needed: an admin isn't granted any row access
-- a member doesn't already have).
-- ============================================================================

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role is null or role in ('admin', 'member'));

update public.profiles
   set role = 'admin'
 where id = 'c70cb9e2-e780-4a9a-a0d5-e5c95a55b8e2';

-- ============================================================================
-- verify_ark.sql — read-only checks, run after 001_ark_schema.sql
--
-- Every query here only reads (pg_catalog / information_schema / storage
-- metadata) — nothing writes, nothing drops, nothing alters. Safe to run
-- any time, as often as you like. An empty result on checks 1 and 2 is
-- the "all good" answer; check 3 should return exactly one row with
-- public = false.
-- ============================================================================


-- ============================================================================
-- 1. Any public-schema table WITHOUT row level security enabled?
--
-- Expect: zero rows. Any row returned here is a table serving data with
-- no RLS at all — everything in 001_ark_schema.sql turns this on, so a
-- row showing up means either that migration didn't fully apply, or a
-- table was added by hand afterwards without it.
-- ============================================================================

select
  n.nspname as schema,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity
order by c.relname;


-- ============================================================================
-- 2. Any policy (table or storage) that grants anything to anon?
--
-- Expect: zero rows. pg_policies.roles is the list of roles a policy
-- applies to; '{public}' (no explicit "to" clause when the policy was
-- created) covers anon too, since every role is a member of public. Every
-- policy in 001_ark_schema.sql is written "to authenticated" explicitly —
-- a row here means some policy (in public OR storage) was written
-- without that, and anon can use it.
-- ============================================================================

select
  schemaname,
  tablename,
  policyname,
  cmd as command,
  roles
from pg_policies
where schemaname in ('public', 'storage')
  and (
    'anon' = any (roles)
    or 'public' = any (roles)
  )
order by schemaname, tablename, policyname;


-- ============================================================================
-- 3. Does the project-documents bucket exist, and is it private?
--
-- Expect: exactly one row, with public = false. No rows means the bucket
-- was never created; public = true means anyone with the anon key could
-- read every file in it directly from Storage, bypassing RLS entirely.
-- ============================================================================

select id, name, public
from storage.buckets
where id = 'project-documents';

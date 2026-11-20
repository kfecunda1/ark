-- ============================================================================
-- Migration 026: Delete project — admin only
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 025_payouts.sql have already been applied. Safe to re-run —
-- DROP POLICY IF EXISTS before CREATE.
--
--   projects_delete_registered (001_ark_schema.sql) let any registered
--   user delete a project — this replaces it with an admin-only policy,
--   same "is_registered_user() and is_admin()" shape every other
--   admin-only write policy in this app uses (e.g. statuses_update_
--   admin, 019_statuses.sql; payout_groups_*_admin, 025_payouts.sql).
--
--   No other change is needed: every child table (project_tranches,
--   project_documents, project_steps, notes, project_products,
--   project_intermediaries, and — via project_tranches —
--   tranche_payouts/tranche_payout_shares) already cascades on delete,
--   and the existing log_project_activity() trigger (001_ark_schema.sql)
--   already writes a 'deleted' activity_log row with the project's own
--   name as the summary and nothing else — no payout figures ever
--   reach it, since tranche_payouts/tranche_payout_shares have no
--   activity_log trigger of their own (025_payouts.sql) and this
--   migration doesn't add one.
-- ============================================================================

begin;

drop policy if exists "projects_delete_registered" on public.projects;

drop policy if exists "projects_delete_admin" on public.projects;
create policy "projects_delete_admin"
  on public.projects for delete
  to authenticated
  using (public.is_registered_user() and public.is_admin());

commit;

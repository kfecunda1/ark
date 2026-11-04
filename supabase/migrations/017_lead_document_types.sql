-- ============================================================================
-- Migration 017: Expand lead document types
--
-- Widens the lead_documents.document_type CHECK constraint from
-- ('CIS', 'Other') to ('CIS', 'MOU', 'SPA', 'IMFPA', 'Other'). Output-only:
-- no table/column changes, existing rows are unaffected since 'CIS' and
-- 'Other' remain valid. Run this manually in the Supabase SQL editor,
-- after 001-016 have already been applied. Safe to re-run.
-- ============================================================================

alter table public.lead_documents
  drop constraint if exists lead_documents_document_type_check;

alter table public.lead_documents
  add constraint lead_documents_document_type_check
  check (document_type in ('CIS', 'MOU', 'SPA', 'IMFPA', 'Other'));

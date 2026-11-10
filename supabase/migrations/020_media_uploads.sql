-- ============================================================================
-- Migration 020: Media uploads + link documents
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 019_statuses.sql have already been applied. Safe to re-run —
-- every statement uses IF EXISTS/IF NOT EXISTS, DROP ... IF EXISTS before
-- CREATE, or a plain idempotent UPDATE.
--
--   1. project_documents / contact_documents: file_path becomes nullable
--      and a new `url` column is added, so a row can be either an
--      uploaded file (file_path set, url null) or a link to a file kept
--      elsewhere (url set, file_path null) — a check constraint enforces
--      exactly one of the two. file_name stays required either way: for
--      a link it's the name the user gave it.
--   2. Both storage buckets get a file_size_limit (50 MB, the Supabase
--      free-plan per-file ceiling) and an allowed_mime_types list that
--      now also covers images (JPG/PNG/HEIC) and video (MP4/MOV) on top
--      of the existing PDF/Word types. The app always sends an explicit
--      Content-Type derived from the file's extension (lib/storage.ts's
--      contentTypeForFile) rather than trusting the browser, so this
--      list is the real gate.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. project_documents / contact_documents: nullable file_path + url
-- ----------------------------------------------------------------------------

alter table public.project_documents
  alter column file_path drop not null;

alter table public.project_documents
  add column if not exists url text;

alter table public.project_documents
  drop constraint if exists project_documents_file_path_or_url_check;

alter table public.project_documents
  add constraint project_documents_file_path_or_url_check
  check (
    (file_path is not null and url is null)
    or (file_path is null and url is not null)
  );

alter table public.contact_documents
  alter column file_path drop not null;

alter table public.contact_documents
  add column if not exists url text;

alter table public.contact_documents
  drop constraint if exists contact_documents_file_path_or_url_check;

alter table public.contact_documents
  add constraint contact_documents_file_path_or_url_check
  check (
    (file_path is not null and url is null)
    or (file_path is null and url is not null)
  );

-- ----------------------------------------------------------------------------
-- 2. Storage buckets: size limit + allowed mime types
-- ----------------------------------------------------------------------------

update storage.buckets
set
  file_size_limit = 52428800, -- 50 MB
  allowed_mime_types = array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
where id in ('project-documents', 'contact-documents');

commit;

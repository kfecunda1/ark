-- ============================================================================
-- Migration 009: Procedure documents (multiple, replacing document_path)
--
-- Replaces the single document_path column on procedures with a
-- procedure_documents table, same shape/pattern as lead_documents (minus
-- the document_type distinction — procedures just have files). Run this
-- manually in the Supabase SQL editor, after 001-008 have already been
-- applied.
--
-- The table/policy statements are safe to re-run. The data migration and
-- column drop at the bottom are not re-runnable once applied (the second
-- run would find document_path already dropped and error out).
--
-- procedure_id uses ON DELETE CASCADE: a procedure_documents row only
-- makes sense attached to its procedure, so deleting a procedure should
-- not leave orphaned metadata rows behind. As with lead_documents, this
-- only cleans up the database row — the underlying Storage object is a
-- separate system and is NOT removed by this cascade, so app code that
-- deletes a procedure must still explicitly delete its Storage objects.
-- ============================================================================


-- ============================================================================
-- Table
-- ============================================================================

create table if not exists public.procedure_documents (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  file_path text not null,
  file_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists procedure_documents_procedure_id_idx on public.procedure_documents (procedure_id);


-- ============================================================================
-- Row Level Security (same "registered user" pattern as other tables)
-- ============================================================================

alter table public.procedure_documents enable row level security;

drop policy if exists "procedure_documents_select_registered" on public.procedure_documents;
create policy "procedure_documents_select_registered"
  on public.procedure_documents for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "procedure_documents_insert_registered" on public.procedure_documents;
create policy "procedure_documents_insert_registered"
  on public.procedure_documents for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "procedure_documents_update_registered" on public.procedure_documents;
create policy "procedure_documents_update_registered"
  on public.procedure_documents for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "procedure_documents_delete_registered" on public.procedure_documents;
create policy "procedure_documents_delete_registered"
  on public.procedure_documents for delete
  to authenticated
  using (public.is_registered_user());


-- ============================================================================
-- Data migration: document_path -> procedure_documents
--
-- file_name is derived the same way the app's displayFileName() helper
-- does: strip the leading "<uuid>-" prefix that buildDocumentPath() adds,
-- falling back to the full path if it doesn't match that shape.
-- ============================================================================

do $$
declare
  proc_record record;
  uuid_prefix_pattern constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-';
begin
  for proc_record in
    select id, document_path
    from public.procedures
    where document_path is not null
  loop
    insert into public.procedure_documents (procedure_id, file_path, file_name)
    values (
      proc_record.id,
      proc_record.document_path,
      coalesce(
        nullif(regexp_replace(proc_record.document_path, uuid_prefix_pattern, '', 'i'), ''),
        proc_record.document_path
      )
    );
  end loop;
end $$;


-- ============================================================================
-- Drop the old single-document column now that every procedure has been
-- migrated
-- ============================================================================

alter table public.procedures
  drop column if exists document_path;

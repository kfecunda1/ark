-- ============================================================================
-- Migration 035: Meeting notes
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 034_opportunities.sql have already been applied. Safe to
-- re-run — every statement uses IF NOT EXISTS / DROP ... IF EXISTS
-- before CREATE / CREATE OR REPLACE.
--
-- Order: widen the two existing check constraints that need it FIRST
-- (activity_log_entity_type_check, inbox_items_filed_to_type_check —
-- same lesson every migration since 013_projects_restructure.sql has
-- followed), then the notes/project_steps column additions, then the
-- two new tables, then every trigger last.
--
-- Scope
-- -----
-- A meeting is just notes.kind = 'meeting' — same table, same RLS, same
-- activity-log trigger (log_note_activity() already diffs every column
-- generically via activity_changed_fields, so the new columns below
-- need no trigger rebuild at all) — with three things a plain note
-- doesn't have: a required meeting_date, participants (note_participants,
-- below), and its own attachments (note_documents, below).
--
--   1. activity_log_entity_type_check rebuilt from the full current
--      list (001_ark_schema.sql through 034_opportunities.sql) plus
--      'note_participant' and 'note_document'.
--   2. inbox_items_filed_to_type_check widened to accept 'opportunity'
--      and 'note'. 'opportunity' is a fix carried over from 034_
--      opportunities.sql, which added opportunity filing to the app
--      (lib/actions/inbox.ts) but missed widening this DB constraint —
--      filing an inbox item into an opportunity would have been
--      rejected at the database until now. 'note' is this migration's
--      own addition: the Inbox's new "File as meeting summary" action
--      marks the originating item filed against the new meeting note,
--      same as every other filing target.
--   3. notes.kind ('note'/'meeting', default 'note'), notes.meeting_date
--      (date, required exactly when kind = 'meeting' — enforced both
--      ways by notes_meeting_date_required), notes.source_note_id (self-
--      reference, nullable — set on an action-item note created from a
--      meeting that isn't project-linked, see point 4below; ON DELETE
--      SET NULL so deleting the meeting note never deletes or orphans
--      the action item, just drops the backlink).
--   4. project_steps.source_note_id — same self-reference idea as
--      notes.source_note_id above, for an action item that *is*
--      project-linked (it becomes a project_steps row, kind
--      'next_step', instead of a second notes row): "the meeting shows
--      its action items" queries whichever of the two this is, by
--      source_note_id; "each action item links back to its meeting" is
--      this column itself. ON DELETE SET NULL, same reasoning.
--   5. note_participants — which `people` attended a given meeting.
--      Unique (note_id, person_id); person_id is ON DELETE RESTRICT,
--      same "the link IS the point of the row" reasoning receiver_
--      intermediaries/project_intermediaries already established
--      (018_intermediaries.sql) — lib/actions/people.ts's deletePerson
--      is extended to check this and return a friendly error first,
--      same belt-and-suspenders shape as its existing project/receiver
--      checks.
--   6. note_documents — a meeting's attachments. Same shape as
--      project_documents/opportunity_documents: file_path/url mutually
--      exclusive, SHA-256 duplicate detection (a unique partial index
--      on (note_id, file_hash)), document_type referencing
--      document_types(name) on update cascade. New private storage
--      bucket "note-documents", same 50 MB limit and allowed mime
--      types as the others.
--   7. Triggers: log_note_participant_activity() (entity_type
--      'note_participant', mirrors log_receiver_intermediary_activity())
--      and log_note_document_activity() (entity_type 'note_document',
--      mirrors log_opportunity_document_activity()). log_note_activity()
--      and log_project_step_activity() are NOT rebuilt — both already
--      diff every column generically, so kind/meeting_date/
--      source_note_id fall into their existing "fields changed" chip
--      with no trigger change at all.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Widen activity_log_entity_type_check
-- ----------------------------------------------------------------------------

alter table public.activity_log
  drop constraint if exists activity_log_entity_type_check;

alter table public.activity_log
  add constraint activity_log_entity_type_check
  check (entity_type in (
    'project', 'contact', 'project_document', 'contact_product', 'contact_document',
    'project_step', 'backup', 'password_change', 'product', 'document_type', 'app_settings',
    'user', 'project_product', 'note', 'person', 'receiver_intermediary', 'project_intermediary',
    'status', 'project_tranche', 'opportunity', 'opportunity_document',
    'note_participant', 'note_document'
  ));

-- ----------------------------------------------------------------------------
-- 2. Widen inbox_items_filed_to_type_check
-- ----------------------------------------------------------------------------

alter table public.inbox_items
  drop constraint if exists inbox_items_filed_to_type_check;

alter table public.inbox_items
  add constraint inbox_items_filed_to_type_check
  check (filed_to_type in ('project', 'contact', 'opportunity', 'note'));

-- ----------------------------------------------------------------------------
-- 3. notes: kind, meeting_date, source_note_id
-- ----------------------------------------------------------------------------

alter table public.notes
  add column if not exists kind text not null default 'note';

alter table public.notes
  drop constraint if exists notes_kind_check;

alter table public.notes
  add constraint notes_kind_check check (kind in ('note', 'meeting'));

alter table public.notes
  add column if not exists meeting_date date;

alter table public.notes
  drop constraint if exists notes_meeting_date_required;

alter table public.notes
  add constraint notes_meeting_date_required check ((kind = 'meeting') = (meeting_date is not null));

alter table public.notes
  add column if not exists source_note_id uuid references public.notes (id) on delete set null;

create index if not exists notes_kind_idx on public.notes (kind);
create index if not exists notes_source_note_id_idx on public.notes (source_note_id);

-- ----------------------------------------------------------------------------
-- 4. project_steps.source_note_id
-- ----------------------------------------------------------------------------

alter table public.project_steps
  add column if not exists source_note_id uuid references public.notes (id) on delete set null;

create index if not exists project_steps_source_note_id_idx on public.project_steps (source_note_id);

-- ----------------------------------------------------------------------------
-- 5. note_participants
-- ----------------------------------------------------------------------------

create table if not exists public.note_participants (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (note_id, person_id)
);

create index if not exists note_participants_note_id_idx on public.note_participants (note_id);
create index if not exists note_participants_person_id_idx on public.note_participants (person_id);

alter table public.note_participants enable row level security;

drop policy if exists "note_participants_select_registered" on public.note_participants;
create policy "note_participants_select_registered"
  on public.note_participants for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "note_participants_insert_registered" on public.note_participants;
create policy "note_participants_insert_registered"
  on public.note_participants for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "note_participants_update_registered" on public.note_participants;
create policy "note_participants_update_registered"
  on public.note_participants for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "note_participants_delete_registered" on public.note_participants;
create policy "note_participants_delete_registered"
  on public.note_participants for delete
  to authenticated
  using (public.is_registered_user());

-- ----------------------------------------------------------------------------
-- 6. note_documents (+ private storage bucket)
-- ----------------------------------------------------------------------------

create table if not exists public.note_documents (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  document_type text not null references public.document_types (name) on update cascade,
  file_path text,
  file_name text not null,
  file_hash text,
  url text,
  created_at timestamptz not null default now(),
  constraint note_documents_file_path_or_url_check check (
    (file_path is not null and url is null)
    or (file_path is null and url is not null)
  )
);

create index if not exists note_documents_note_id_idx on public.note_documents (note_id);
create index if not exists note_documents_file_hash_idx on public.note_documents (file_hash);

create unique index if not exists note_documents_note_id_file_hash_key
  on public.note_documents (note_id, file_hash)
  where file_hash is not null;

alter table public.note_documents enable row level security;

drop policy if exists "note_documents_select_registered" on public.note_documents;
create policy "note_documents_select_registered"
  on public.note_documents for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "note_documents_insert_registered" on public.note_documents;
create policy "note_documents_insert_registered"
  on public.note_documents for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "note_documents_update_registered" on public.note_documents;
create policy "note_documents_update_registered"
  on public.note_documents for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "note_documents_delete_registered" on public.note_documents;
create policy "note_documents_delete_registered"
  on public.note_documents for delete
  to authenticated
  using (public.is_registered_user());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'note-documents',
  'note-documents',
  false,
  52428800,
  array[
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
)
on conflict (id) do nothing;

drop policy if exists "note_documents_bucket_select_registered" on storage.objects;
create policy "note_documents_bucket_select_registered"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'note-documents'
    and public.is_registered_user()
  );

drop policy if exists "note_documents_bucket_insert_registered" on storage.objects;
create policy "note_documents_bucket_insert_registered"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'note-documents'
    and public.is_registered_user()
  );

drop policy if exists "note_documents_bucket_update_registered" on storage.objects;
create policy "note_documents_bucket_update_registered"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'note-documents'
    and public.is_registered_user()
  )
  with check (
    bucket_id = 'note-documents'
    and public.is_registered_user()
  );

drop policy if exists "note_documents_bucket_delete_registered" on storage.objects;
create policy "note_documents_bucket_delete_registered"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'note-documents'
    and public.is_registered_user()
  );

-- ----------------------------------------------------------------------------
-- 7a. Trigger: note_participants (insert/delete only — a row is only
--     ever added or removed, never edited in place, same as receiver_
--     intermediaries/project_intermediaries).
-- ----------------------------------------------------------------------------

create or replace function public.log_note_participant_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_note_participant_activity$
declare
  v_actor_id uuid;
  v_actor_label text;
  v_entity_id uuid;
  v_action text;
  v_summary text;
  v_details jsonb;
begin
  if tg_op = 'INSERT' then
    v_entity_id := new.id;
    v_action := 'created';
    v_details := jsonb_build_object('parent_type', 'note', 'parent_id', new.note_id, 'person_id', new.person_id);

    select nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
      into v_summary
      from public.people p where p.id = new.person_id;

  else -- DELETE (no UPDATE path — a row is only ever added or removed)
    if not exists (select 1 from public.notes n where n.id = old.note_id) then
      return null;
    end if;

    v_entity_id := old.id;
    v_action := 'deleted';
    v_details := jsonb_build_object('parent_type', 'note', 'parent_id', old.note_id, 'person_id', old.person_id);

    select nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
      into v_summary
      from public.people p where p.id = old.person_id;
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('note_participant', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_note_participant_activity$;

drop trigger if exists note_participants_log_activity on public.note_participants;
create trigger note_participants_log_activity
  after insert or delete on public.note_participants
  for each row
  execute function public.log_note_participant_activity();

-- ----------------------------------------------------------------------------
-- 7b. Trigger: note_documents — same shape (and same cascade-delete
--     skip) as log_opportunity_document_activity() (034_opportunities.sql).
-- ----------------------------------------------------------------------------

create or replace function public.log_note_document_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_note_document_activity$
declare
  v_actor_id uuid;
  v_actor_label text;
  v_entity_id uuid;
  v_action text;
  v_summary text;
  v_details jsonb;
  v_changed text[];
begin
  if tg_op = 'INSERT' then
    v_entity_id := new.id;
    v_action := 'created';
    v_summary := new.file_name;
    v_details := jsonb_build_object(
      'parent_type', 'note',
      'parent_id', new.note_id,
      'document_type', new.document_type
    );

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new), array['file_hash']);

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := new.file_name;
    v_details := jsonb_build_object(
      'parent_type', 'note',
      'parent_id', new.note_id,
      'document_type', new.document_type,
      'fields', to_jsonb(v_changed)
    );

  else -- DELETE
    if not exists (select 1 from public.notes n where n.id = old.note_id) then
      return null;
    end if;

    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := old.file_name;
    v_details := jsonb_build_object(
      'parent_type', 'note',
      'parent_id', old.note_id,
      'document_type', old.document_type
    );
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
  values ('note_document', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_note_document_activity$;

drop trigger if exists note_documents_log_activity on public.note_documents;
create trigger note_documents_log_activity
  after insert or update or delete on public.note_documents
  for each row
  execute function public.log_note_document_activity();

revoke all on function public.log_note_participant_activity() from public, anon, authenticated;
revoke all on function public.log_note_document_activity() from public, anon, authenticated;

commit;

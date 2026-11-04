-- ============================================================================
-- Migration 020: Duplicate prevention
--
-- Output only — run this manually in the Supabase SQL editor, after
-- 001-019 have already been applied. Safe to re-run: every statement uses
-- IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS guards, and the
-- revoke statements at the bottom are idempotent on their own.
--
-- What this adds
-- ---------------
-- * file_hash (SHA-256, computed client-side) on lead_documents and
--   procedure_documents, with a unique partial index per record so the
--   exact same file cannot be attached twice to the SAME lead/procedure.
--   The column is nullable because existing rows have no hash yet —
--   scripts/backfill-file-hashes.ts fills it in afterwards, and the app
--   treats a null hash as "unknown, not a duplicate" rather than blocking
--   anything.
-- * possible_duplicate on procedures, for procedures created by the
--   Telegram webhook (no human present to confirm "Add anyway") whose
--   raw_content exactly matches an existing procedure.
-- * telegram_processed_updates, so the webhook can recognize a Telegram
--   retry of an update it already handled and no-op instead of creating
--   a second procedure or double-merging a message.
--
-- Why the activity triggers need to change
-- -----------------------------------------
-- scripts/backfill-file-hashes.ts updates file_hash on every existing
-- document row in one pass. Without this change, the log_lead_document_
-- activity / log_procedure_document_activity triggers (migration 019)
-- would log an "updated" row for every single document the backfill
-- touches — pure noise, not a real change anyone made. Same idea for
-- possible_duplicate on procedures: the backfill never sets it, but a
-- future bulk correction might, and it's not a field a human edited.
-- Per CREATE OR REPLACE semantics, only the ignore list passed to
-- activity_changed_fields changes in each function below — everything
-- else is byte-for-byte identical to migration 019's definition — and
-- the "revoke all ... from public, anon, authenticated" lines for these
-- three functions are re-issued, since CREATE OR REPLACE does not
-- preserve a function's previously revoked/granted privileges.
-- ============================================================================


-- ============================================================================
-- lead_documents.file_hash / procedure_documents.file_hash
-- ============================================================================

alter table public.lead_documents
  add column if not exists file_hash text;

alter table public.procedure_documents
  add column if not exists file_hash text;

create index if not exists lead_documents_file_hash_idx on public.lead_documents (file_hash);
create index if not exists procedure_documents_file_hash_idx on public.procedure_documents (file_hash);

-- Partial (not full) unique indexes: file_hash is null for every row
-- until the backfill runs, and a plain unique index would reject a
-- second null-hash document on the same record, which is not a
-- duplicate — it's just not hashed yet. "where file_hash is not null"
-- means the constraint only ever applies to rows that actually carry a
-- hash, so pre-backfill documents are never affected.
create unique index if not exists lead_documents_lead_id_file_hash_key
  on public.lead_documents (lead_id, file_hash)
  where file_hash is not null;

create unique index if not exists procedure_documents_procedure_id_file_hash_key
  on public.procedure_documents (procedure_id, file_hash)
  where file_hash is not null;


-- ============================================================================
-- procedures.possible_duplicate
-- ============================================================================

alter table public.procedures
  add column if not exists possible_duplicate boolean not null default false;


-- ============================================================================
-- telegram_processed_updates
--
-- Service-role only: RLS is enabled with NO policies at all (not even
-- select), since nothing in the app UI ever needs to read this table —
-- only the webhook and the reminders-digest cron's pruning step touch
-- it, both via the service role key, which bypasses RLS entirely.
-- ============================================================================

create table if not exists public.telegram_processed_updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);

alter table public.telegram_processed_updates enable row level security;


-- ============================================================================
-- log_procedure_activity: now also ignores possible_duplicate
--
-- Identical to migration 019's definition except the ignore list passed
-- to activity_changed_fields in the UPDATE branch.
-- ============================================================================

create or replace function public.log_procedure_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_procedure_activity$
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
    v_summary := public.activity_procedure_label(new.title, new.raw_content);
    v_details := jsonb_build_object('status', new.status, 'source', new.source);

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(
      to_jsonb(old),
      to_jsonb(new),
      array['updated_at', 'possible_duplicate']
    );

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := public.activity_procedure_label(new.title, new.raw_content);
    v_details := jsonb_build_object('fields', to_jsonb(v_changed));

    if new.status is distinct from old.status then
      v_details := v_details || jsonb_build_object('status', jsonb_build_array(old.status, new.status));
    end if;

  else -- DELETE
    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := public.activity_procedure_label(old.title, old.raw_content);
    v_details := jsonb_build_object('status', old.status, 'source', old.source);
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (
    entity_type, entity_id, action, summary, details, actor_id, actor_label
  )
  values ('procedure', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_procedure_activity$;


-- ============================================================================
-- log_lead_document_activity: now also ignores file_hash
--
-- Identical to migration 019's definition except the ignore list passed
-- to activity_changed_fields in the UPDATE branch.
-- ============================================================================

create or replace function public.log_lead_document_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_lead_document_activity$
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
      'parent_type', 'lead',
      'parent_id', new.lead_id,
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
      'parent_type', 'lead',
      'parent_id', new.lead_id,
      'document_type', new.document_type,
      'fields', to_jsonb(v_changed)
    );

  else -- DELETE
    if not exists (select 1 from public.leads l where l.id = old.lead_id) then
      return null;
    end if;

    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := old.file_name;
    v_details := jsonb_build_object(
      'parent_type', 'lead',
      'parent_id', old.lead_id,
      'document_type', old.document_type
    );
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (
    entity_type, entity_id, action, summary, details, actor_id, actor_label
  )
  values ('lead_document', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_lead_document_activity$;


-- ============================================================================
-- log_procedure_document_activity: now also ignores file_hash
--
-- Identical to migration 019's definition except the ignore list passed
-- to activity_changed_fields in the UPDATE branch.
-- ============================================================================

create or replace function public.log_procedure_document_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_procedure_document_activity$
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
    v_details := jsonb_build_object('parent_type', 'procedure', 'parent_id', new.procedure_id);

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new), array['file_hash']);

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := new.file_name;
    v_details := jsonb_build_object(
      'parent_type', 'procedure',
      'parent_id', new.procedure_id,
      'fields', to_jsonb(v_changed)
    );

  else -- DELETE
    if not exists (select 1 from public.procedures p where p.id = old.procedure_id) then
      return null;
    end if;

    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := old.file_name;
    v_details := jsonb_build_object('parent_type', 'procedure', 'parent_id', old.procedure_id);
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (
    entity_type, entity_id, action, summary, details, actor_id, actor_label
  )
  values ('procedure_document', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_procedure_document_activity$;


-- ============================================================================
-- Re-lock down the three functions just replaced
--
-- CREATE OR REPLACE does not preserve a function's previously revoked
-- privileges, and (per migration 019's design notes) every SECURITY
-- DEFINER function in the public schema is otherwise exposed as a
-- callable PostgREST RPC endpoint with EXECUTE granted to PUBLIC by
-- default. Re-issuing the same revoke closes that back up. Trigger
-- functions only need EXECUTE at CREATE TRIGGER time (already done in
-- 019 and unaffected by this migration), never when the trigger fires,
-- so this does not touch the triggers' own behavior.
-- ============================================================================

revoke all on function public.log_procedure_activity() from public, anon, authenticated;
revoke all on function public.log_lead_document_activity() from public, anon, authenticated;
revoke all on function public.log_procedure_document_activity() from public, anon, authenticated;

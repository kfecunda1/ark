-- ============================================================================
-- Migration 019: Activity log
--
-- Adds an append-only `activity_log` table, written exclusively by AFTER
-- row triggers on leads / procedures / contacts / lead_documents /
-- procedure_documents. Feeds the Activity page and the end-of-day
-- activity digest (app/api/cron/activity-digest). Run this manually in
-- the Supabase SQL editor, after 001-018 have already been applied.
--
-- Safe to re-run: every statement uses IF NOT EXISTS / CREATE OR REPLACE /
-- DROP ... IF EXISTS guards. The procedures.updated_at backfill at the
-- bottom is also re-runnable (it only touches rows where updated_at is
-- still null, of which there are none after the first run).
--
-- Design notes
-- ------------
-- * Nothing but the triggers writes here: RLS is enabled with a SELECT
--   policy only, and no INSERT/UPDATE/DELETE policies at all, so even a
--   logged-in user with a profiles row cannot forge or rewrite history.
--   The trigger functions are SECURITY DEFINER (owned by the role that
--   runs this migration, i.e. the same role that owns the table), which
--   is what lets them insert despite there being no INSERT policy. The
--   digest route reaches notified_at through the service role key, which
--   bypasses RLS entirely.
--
-- * actor: auth.uid() resolved against profiles -> full_name, falling back
--   to email. When auth.uid() is null the write came from the service role
--   (Telegram webhook, cron job, one-off scripts), and actor_label is
--   'Telegram / system'. actor_id stays null in that case — and also when
--   an authenticated user somehow has no profiles row, since actor_id is a
--   FK into profiles and must not break the write it is only describing.
--
-- * details shape: a *state* value is stored as a scalar ("stage": "new",
--   on created/deleted), a *change* as a two-element before/after array
--   ("stage": ["new", "in_progress"], on updated). "fields" always holds
--   the list of changed column names on an update. Renderers branch on
--   Array.isArray() to tell the two apart.
--
-- * Documents carry their owner in details ("parent_type"/"parent_id") so
--   the Activity page can link a document row to the record it hangs off
--   (documents have no page of their own) and so the digest can roll
--   document events up into that record's single line.
--
-- * Document deletions caused only by the parent going away are NOT
--   logged: in the AFTER DELETE trigger the already-deleted parent row is
--   no longer visible, so a parent-existence check cleanly identifies a
--   cascade. Deletions from Convert to Lead (which moves documents off a
--   procedure before deleting it) are indistinguishable at the trigger
--   level from a hand-deleted document — same SQL, same actor, parent
--   still present — so those stay in the log and are instead collapsed
--   into the parent's line by the digest.
-- ============================================================================


-- ============================================================================
-- Table
-- ============================================================================

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entity_type text not null check (
    entity_type in ('lead', 'procedure', 'contact', 'lead_document', 'procedure_document')
  ),
  entity_id uuid not null,
  action text not null check (action in ('created', 'updated', 'deleted')),
  summary text,
  details jsonb not null default '{}'::jsonb,
  -- ON DELETE SET NULL: removing a profile must not erase or block the
  -- history it produced. actor_label keeps the name readable afterwards.
  actor_id uuid references public.profiles (id) on delete set null,
  actor_label text,
  notified_at timestamptz
);

-- Activity page: newest first.
create index if not exists activity_log_created_at_idx on public.activity_log (created_at desc);

-- Digest: the un-notified backlog, which stays small while the cron runs.
create index if not exists activity_log_unnotified_idx
  on public.activity_log (created_at)
  where notified_at is null;


-- ============================================================================
-- Row Level Security
--
-- SELECT only, for registered users (same "registered user" pattern as
-- every other table). Deliberately no INSERT/UPDATE/DELETE policies —
-- see the design notes above.
-- ============================================================================

alter table public.activity_log enable row level security;

drop policy if exists "activity_log_select_registered" on public.activity_log;
create policy "activity_log_select_registered"
  on public.activity_log for select
  to authenticated
  using (public.is_registered_user());


-- ============================================================================
-- Helper: who is acting
-- ============================================================================

create or replace function public.activity_actor(
  out actor_id uuid,
  out actor_label text
)
language plpgsql
security definer
set search_path = public
stable
as $activity_actor$
declare
  uid uuid := auth.uid();
  prof record;
begin
  actor_id := null;

  if uid is null then
    -- Service role: Telegram webhook, cron, maintenance scripts.
    actor_label := 'Telegram / system';
    return;
  end if;

  select p.id, p.full_name, p.email
    into prof
    from public.profiles p
   where p.id = uid;

  if found then
    actor_id := prof.id;
    actor_label := coalesce(
      nullif(btrim(prof.full_name), ''),
      nullif(btrim(prof.email), ''),
      'Unknown user'
    );
  else
    -- Authenticated but unregistered: actor_id must stay null (FK), and
    -- the RLS policies would have blocked the write anyway.
    actor_label := 'Unknown user';
  end if;
end;
$activity_actor$;


-- ============================================================================
-- Helper: which columns actually changed
--
-- Compares two row snapshots and returns the changed column names, minus
-- the ones in p_ignore. An empty result means "nothing worth logging" —
-- that is what keeps bookkeeping-only UPDATEs (a touched updated_at /
-- stage_updated_at, or a form re-saved with no edits) out of the log.
-- Keys present on only one side count as changed, so the helper stays
-- correct across future column additions.
-- ============================================================================

create or replace function public.activity_changed_fields(
  p_old jsonb,
  p_new jsonb,
  p_ignore text[] default '{}'::text[]
)
returns text[]
language sql
immutable
as $activity_changed_fields$
  select coalesce(array_agg(k.key order by k.key), '{}'::text[])
    from (
      select key from jsonb_each(p_old)
      union
      select key from jsonb_each(p_new)
    ) k
   where not (k.key = any(p_ignore))
     and (p_old -> k.key) is distinct from (p_new -> k.key);
$activity_changed_fields$;


-- ============================================================================
-- Helpers: readable label of a record at the moment it changed
-- ============================================================================

-- Lead: primary contact name, else product type.
create or replace function public.activity_lead_label(
  p_primary_contact_id uuid,
  p_product_type text
)
returns text
language plpgsql
security definer
set search_path = public
stable
as $activity_lead_label$
declare
  nm text;
begin
  if p_primary_contact_id is not null then
    select nullif(btrim(c.full_name), '')
      into nm
      from public.contacts c
     where c.id = p_primary_contact_id;

    if nm is not null then
      return nm;
    end if;
  end if;

  return coalesce(nullif(btrim(p_product_type), ''), 'Lead');
end;
$activity_lead_label$;

-- Procedure: title, else raw_content flattened and truncated — mirrors the
-- app's truncate() helper in lib/procedures.ts.
create or replace function public.activity_procedure_label(
  p_title text,
  p_raw_content text
)
returns text
language plpgsql
immutable
as $activity_procedure_label$
declare
  flat text;
  max_len constant int := 60;
begin
  if nullif(btrim(p_title), '') is not null then
    return btrim(p_title);
  end if;

  flat := btrim(regexp_replace(coalesce(p_raw_content, ''), '\s+', ' ', 'g'));

  if flat = '' then
    return 'Procedure';
  elsif length(flat) > max_len then
    return btrim(left(flat, max_len)) || '…';
  end if;

  return flat;
end;
$activity_procedure_label$;


-- ============================================================================
-- Trigger: leads
-- ============================================================================

create or replace function public.log_lead_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_lead_activity$
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
    v_summary := public.activity_lead_label(new.primary_contact_id, new.product_type);
    v_details := jsonb_build_object(
      'stage', new.stage,
      'business_line', new.business_line,
      'priority', new.priority
    );

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(
      to_jsonb(old),
      to_jsonb(new),
      array['updated_at', 'stage_updated_at']
    );

    -- Only bookkeeping columns moved: not worth a log row.
    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := public.activity_lead_label(new.primary_contact_id, new.product_type);
    v_details := jsonb_build_object('fields', to_jsonb(v_changed));

    if new.stage is distinct from old.stage then
      v_details := v_details || jsonb_build_object('stage', jsonb_build_array(old.stage, new.stage));
    end if;
    if new.archived is distinct from old.archived then
      v_details := v_details || jsonb_build_object('archived', jsonb_build_array(old.archived, new.archived));
    end if;
    if new.priority is distinct from old.priority then
      v_details := v_details || jsonb_build_object('priority', jsonb_build_array(old.priority, new.priority));
    end if;

  else -- DELETE
    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := public.activity_lead_label(old.primary_contact_id, old.product_type);
    v_details := jsonb_build_object(
      'stage', old.stage,
      'business_line', old.business_line
    );
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (
    entity_type, entity_id, action, summary, details, actor_id, actor_label
  )
  values ('lead', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_lead_activity$;

drop trigger if exists leads_log_activity on public.leads;
create trigger leads_log_activity
  after insert or update or delete on public.leads
  for each row
  execute function public.log_lead_activity();


-- ============================================================================
-- Trigger: procedures
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
      array['updated_at']
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

drop trigger if exists procedures_log_activity on public.procedures;
create trigger procedures_log_activity
  after insert or update or delete on public.procedures
  for each row
  execute function public.log_procedure_activity();


-- ============================================================================
-- Trigger: contacts
-- ============================================================================

create or replace function public.log_contact_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_contact_activity$
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
    v_summary := nullif(btrim(new.full_name), '');
    v_details := '{}'::jsonb;

  elsif tg_op = 'UPDATE' then
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new));

    if array_length(v_changed, 1) is null then
      return null;
    end if;

    v_entity_id := new.id;
    v_action := 'updated';
    v_summary := nullif(btrim(new.full_name), '');
    v_details := jsonb_build_object('fields', to_jsonb(v_changed));

    if new.full_name is distinct from old.full_name then
      v_details := v_details || jsonb_build_object(
        'full_name', jsonb_build_array(old.full_name, new.full_name)
      );
    end if;

  else -- DELETE
    v_entity_id := old.id;
    v_action := 'deleted';
    v_summary := nullif(btrim(old.full_name), '');
    v_details := '{}'::jsonb;
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  insert into public.activity_log (
    entity_type, entity_id, action, summary, details, actor_id, actor_label
  )
  values ('contact', v_entity_id, v_action, v_summary, v_details, v_actor_id, v_actor_label);

  return null;
end;
$log_contact_activity$;

drop trigger if exists contacts_log_activity on public.contacts;
create trigger contacts_log_activity
  after insert or update or delete on public.contacts
  for each row
  execute function public.log_contact_activity();


-- ============================================================================
-- Trigger: lead_documents
--
-- A DELETE whose parent lead is already gone is a cascade from deleting
-- the lead, not a document someone removed on purpose; the lead's own
-- 'deleted' row already says what happened, so skip it.
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
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new));

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

drop trigger if exists lead_documents_log_activity on public.lead_documents;
create trigger lead_documents_log_activity
  after insert or update or delete on public.lead_documents
  for each row
  execute function public.log_lead_document_activity();


-- ============================================================================
-- Trigger: procedure_documents
--
-- Same cascade guard as lead_documents. Note this does NOT catch Convert
-- to Lead, which deletes the document rows while the procedure still
-- exists and only drops the procedure afterwards — the digest collapses
-- those into the procedure's line instead.
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
    v_changed := public.activity_changed_fields(to_jsonb(old), to_jsonb(new));

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

drop trigger if exists procedure_documents_log_activity on public.procedure_documents;
create trigger procedure_documents_log_activity
  after insert or update or delete on public.procedure_documents
  for each row
  execute function public.log_procedure_document_activity();


-- ============================================================================
-- procedures.updated_at
--
-- Leads already track updated_at via the set_updated_at() trigger from
-- 001 (schema.sql); procedures now do the same, so the Procedure detail
-- page can show "Last updated". Added nullable first and backfilled to
-- created_at, because a plain NOT NULL DEFAULT now() would have stamped
-- every existing procedure as "just updated".
-- ============================================================================

alter table public.procedures
  add column if not exists updated_at timestamptz;

update public.procedures
   set updated_at = created_at
 where updated_at is null;

alter table public.procedures
  alter column updated_at set default now();

alter table public.procedures
  alter column updated_at set not null;

drop trigger if exists procedures_set_updated_at on public.procedures;
create trigger procedures_set_updated_at
  before update on public.procedures
  for each row
  execute function public.set_updated_at();


-- ============================================================================
-- Lock down helper and trigger functions
--
-- Every function above is SECURITY DEFINER (or, for activity_changed_fields
-- /activity_procedure_label, plain helpers alongside ones that are) in the
-- public schema. Supabase exposes public-schema functions as callable
-- PostgREST endpoints (RPC), and Postgres grants EXECUTE on a new function
-- to PUBLIC by default. Left alone, that means anyone holding the anon key
-- could call a SECURITY DEFINER function like log_lead_activity() or
-- activity_actor() directly over the API and have it run with this
-- migration's privileges — bypassing activity_log's RLS (which has no
-- INSERT policy at all) and reading/writing through whatever each function
-- touches, regardless of the caller's own role.
--
-- Revoking EXECUTE from public/anon/authenticated closes that off. The
-- five trigger functions (returns trigger) are unaffected: Postgres only
-- checks EXECUTE privilege on a trigger function at CREATE TRIGGER time,
-- never when the trigger itself fires, so AFTER INSERT/UPDATE/DELETE on
-- leads/procedures/contacts/lead_documents/procedure_documents keeps
-- working exactly as before. The four helpers (activity_actor,
-- activity_changed_fields, activity_lead_label, activity_procedure_label)
-- are only ever called from inside those trigger functions, never
-- directly by app code, so they need no EXECUTE grant to anyone.
--
-- `revoke` is idempotent on its own (revoking an already-absent privilege
-- is a no-op, not an error), so this section is safe to re-run; what
-- actually makes a re-run safe is that every signature below matches the
-- function as defined earlier in this file byte-for-byte, including
-- activity_actor's OUT-only parameter list (OUT parameters are not part
-- of a function's identifying signature, so it is addressed as `()`) and
-- activity_changed_fields' default on p_ignore (defaults are irrelevant
-- to the signature too — only the parameter types matter here).
-- ============================================================================

revoke all on function public.activity_actor() from public, anon, authenticated;
revoke all on function public.activity_lead_label(uuid, text) from public, anon, authenticated;
revoke all on function public.activity_procedure_label(text, text) from public, anon, authenticated;
revoke all on function public.activity_changed_fields(jsonb, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.log_lead_activity() from public, anon, authenticated;
revoke all on function public.log_procedure_activity() from public, anon, authenticated;
revoke all on function public.log_contact_activity() from public, anon, authenticated;
revoke all on function public.log_lead_document_activity() from public, anon, authenticated;
revoke all on function public.log_procedure_document_activity() from public, anon, authenticated;

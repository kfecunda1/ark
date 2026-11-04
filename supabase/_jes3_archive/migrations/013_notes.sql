-- ============================================================================
-- Migration 013: Notes / Reminders
--
-- Adds a general-purpose notes table. A note can optionally be flagged as
-- a reminder (with a due date) and optionally linked to exactly one of a
-- lead, procedure, or contact. Run this manually in the Supabase SQL
-- editor, after 001-012 have already been applied. Safe to re-run.
--
-- Linked records use ON DELETE CASCADE: a note attached to a lead,
-- procedure, or contact only makes sense alongside it, so deleting the
-- parent record should not leave orphaned notes behind. The CHECK
-- constraint keeps a note pointed at at most one parent record, matching
-- the single-link-picker UI (a note is unlinked, or linked to exactly one
-- lead/procedure/contact — never more than one at a time).
-- ============================================================================

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  title text,
  content text not null,
  is_reminder boolean not null default false,
  due_date date,
  reminded_at timestamptz,
  lead_id uuid references public.leads (id) on delete cascade,
  procedure_id uuid references public.procedures (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  constraint notes_at_most_one_link check (
    (case when lead_id is not null then 1 else 0 end)
    + (case when procedure_id is not null then 1 else 0 end)
    + (case when contact_id is not null then 1 else 0 end)
    <= 1
  )
);

create index if not exists notes_lead_id_idx on public.notes (lead_id);
create index if not exists notes_procedure_id_idx on public.notes (procedure_id);
create index if not exists notes_contact_id_idx on public.notes (contact_id);
create index if not exists notes_reminders_idx on public.notes (is_reminder, due_date, reminded_at);


-- ============================================================================
-- Row Level Security (same "registered user" pattern as other tables)
-- ============================================================================

alter table public.notes enable row level security;

drop policy if exists "notes_select_registered" on public.notes;
create policy "notes_select_registered"
  on public.notes for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "notes_insert_registered" on public.notes;
create policy "notes_insert_registered"
  on public.notes for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "notes_update_registered" on public.notes;
create policy "notes_update_registered"
  on public.notes for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "notes_delete_registered" on public.notes;
create policy "notes_delete_registered"
  on public.notes for delete
  to authenticated
  using (public.is_registered_user());

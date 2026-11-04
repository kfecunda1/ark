-- ============================================================================
-- Migration 002: Contacts
--
-- Introduces a shared `contacts` table and links it from leads/procedures,
-- replacing the free-text contact_name / contact_info / counterparty_name
-- columns on leads. Run this manually in the Supabase SQL editor, after
-- 001 (schema.sql) has already been applied.
--
-- The table/policy/column statements below are safe to re-run (they use
-- IF NOT EXISTS / DROP ... IF EXISTS guards, same as 001). The data
-- migration and column drops at the bottom are NOT safe to re-run once
-- applied: the second run would find contact_name/counterparty_name
-- already dropped and error out. Review before re-running.
-- ============================================================================


-- ============================================================================
-- Table
-- ============================================================================

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  full_name text not null,
  phone text,
  email text
);


-- ============================================================================
-- Row Level Security (same "registered user" pattern as leads/procedures)
-- ============================================================================

alter table public.contacts enable row level security;

drop policy if exists "contacts_select_registered" on public.contacts;
create policy "contacts_select_registered"
  on public.contacts for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "contacts_insert_registered" on public.contacts;
create policy "contacts_insert_registered"
  on public.contacts for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "contacts_update_registered" on public.contacts;
create policy "contacts_update_registered"
  on public.contacts for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "contacts_delete_registered" on public.contacts;
create policy "contacts_delete_registered"
  on public.contacts for delete
  to authenticated
  using (public.is_registered_user());


-- ============================================================================
-- New columns linking leads / procedures to contacts
-- ============================================================================

alter table public.leads
  add column if not exists primary_contact_id uuid references public.contacts (id),
  add column if not exists counterparty_contact_id uuid references public.contacts (id);

alter table public.procedures
  add column if not exists contact_id uuid references public.contacts (id);

create index if not exists leads_primary_contact_id_idx on public.leads (primary_contact_id);
create index if not exists leads_counterparty_contact_id_idx on public.leads (counterparty_contact_id);
create index if not exists procedures_contact_id_idx on public.procedures (contact_id);


-- ============================================================================
-- Data migration: contact_name / contact_info / counterparty_name -> contacts
--
-- For each existing lead, a primary contact is created from contact_name
-- plus contact_info (parsed as an email when it looks like one, otherwise
-- stored as phone — which also covers the "doesn't look like either"
-- fallback, since it lands in phone either way). A separate counterparty
-- contact is created from counterparty_name alone (no phone/email was ever
-- captured for the counterparty). This runs as a loop rather than a bulk
-- insert/select so each new contact's id can be written straight back onto
-- the lead it came from.
-- ============================================================================

do $$
declare
  lead_record record;
  new_contact_id uuid;
  email_pattern constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
begin
  for lead_record in
    select id, contact_name, contact_info, counterparty_name
    from public.leads
    where contact_name is not null or counterparty_name is not null
  loop
    if lead_record.contact_name is not null then
      insert into public.contacts (full_name, phone, email)
      values (
        lead_record.contact_name,
        case
          when lead_record.contact_info is not null
               and lead_record.contact_info !~* email_pattern
            then lead_record.contact_info
          else null
        end,
        case
          when lead_record.contact_info is not null
               and lead_record.contact_info ~* email_pattern
            then lead_record.contact_info
          else null
        end
      )
      returning id into new_contact_id;

      update public.leads
      set primary_contact_id = new_contact_id
      where id = lead_record.id;
    end if;

    if lead_record.counterparty_name is not null then
      insert into public.contacts (full_name)
      values (lead_record.counterparty_name)
      returning id into new_contact_id;

      update public.leads
      set counterparty_contact_id = new_contact_id
      where id = lead_record.id;
    end if;
  end loop;
end $$;


-- ============================================================================
-- Drop the old free-text columns now that every lead has been migrated
-- ============================================================================

alter table public.leads
  drop column if exists contact_name,
  drop column if exists contact_info,
  drop column if exists counterparty_name;

-- ============================================================================
-- Migration 016: Lead wallets
--
-- Adds repeatable wallet addresses to leads (a lead can have zero or
-- more), same shape/pattern as procedure_wallets. Run this manually in
-- the Supabase SQL editor, after 001-015 have already been applied.
--
-- The table/policy statements are safe to re-run. The data migration and
-- column drop at the bottom are NOT safe to re-run once applied: the
-- second run would find wallet_address already dropped and error out.
-- Review before re-running.
--
-- lead_id uses ON DELETE CASCADE: a wallet row only makes sense attached
-- to its lead, so deleting a lead should not leave orphaned wallet rows
-- behind.
-- ============================================================================

create table if not exists public.lead_wallets (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  wallet_address text not null,
  created_at timestamptz not null default now()
);

create index if not exists lead_wallets_lead_id_idx on public.lead_wallets (lead_id);


-- ============================================================================
-- Row Level Security (same "registered user" pattern as other tables)
-- ============================================================================

alter table public.lead_wallets enable row level security;

drop policy if exists "lead_wallets_select_registered" on public.lead_wallets;
create policy "lead_wallets_select_registered"
  on public.lead_wallets for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "lead_wallets_insert_registered" on public.lead_wallets;
create policy "lead_wallets_insert_registered"
  on public.lead_wallets for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "lead_wallets_update_registered" on public.lead_wallets;
create policy "lead_wallets_update_registered"
  on public.lead_wallets for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "lead_wallets_delete_registered" on public.lead_wallets;
create policy "lead_wallets_delete_registered"
  on public.lead_wallets for delete
  to authenticated
  using (public.is_registered_user());


-- ============================================================================
-- Data migration: wallet_address -> lead_wallets
-- ============================================================================

insert into public.lead_wallets (lead_id, wallet_address)
select id, wallet_address
from public.leads
where wallet_address is not null;


-- ============================================================================
-- Drop the old single-wallet column now that every lead has been migrated
-- ============================================================================

alter table public.leads
  drop column if exists wallet_address;

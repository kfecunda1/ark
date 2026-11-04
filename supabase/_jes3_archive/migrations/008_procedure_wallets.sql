-- ============================================================================
-- Migration 008: Procedure wallets
--
-- Adds repeatable seller wallet addresses to procedures (a procedure can
-- have zero or more). Run this manually in the Supabase SQL editor, after
-- 001-007 have already been applied. Safe to re-run.
--
-- procedure_id uses ON DELETE CASCADE: a wallet row only makes sense
-- attached to its procedure, so deleting a procedure should not leave
-- orphaned wallet rows behind.
-- ============================================================================

create table if not exists public.procedure_wallets (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  wallet_address text not null,
  created_at timestamptz not null default now()
);

create index if not exists procedure_wallets_procedure_id_idx on public.procedure_wallets (procedure_id);


-- ============================================================================
-- Row Level Security (same "registered user" pattern as other tables)
-- ============================================================================

alter table public.procedure_wallets enable row level security;

drop policy if exists "procedure_wallets_select_registered" on public.procedure_wallets;
create policy "procedure_wallets_select_registered"
  on public.procedure_wallets for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "procedure_wallets_insert_registered" on public.procedure_wallets;
create policy "procedure_wallets_insert_registered"
  on public.procedure_wallets for insert
  to authenticated
  with check (public.is_registered_user());

drop policy if exists "procedure_wallets_update_registered" on public.procedure_wallets;
create policy "procedure_wallets_update_registered"
  on public.procedure_wallets for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "procedure_wallets_delete_registered" on public.procedure_wallets;
create policy "procedure_wallets_delete_registered"
  on public.procedure_wallets for delete
  to authenticated
  using (public.is_registered_user());

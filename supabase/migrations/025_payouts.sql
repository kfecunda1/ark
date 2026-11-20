-- ============================================================================
-- Migration 025: Payouts (admin only)
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 024_show_recovery.sql have already been applied. Safe to
-- re-run — every statement uses IF EXISTS/IF NOT EXISTS, DROP ... IF
-- EXISTS before CREATE, or ON CONFLICT DO NOTHING.
--
--   1. project_tranches.paid_out_on (date, nullable) — a fourth tranche
--      state alongside sent_on/confirmed_on, visible to every
--      registered user (same RLS project_tranches already has; nothing
--      new needed there). A single check constraint carries both
--      rules at once, the same shape 023_tranche_confirmed.sql's own
--      confirmed_on constraint uses: paid_out_on can only be set
--      alongside a confirmed_on, and never before it — which is also
--      what stops clearing confirmed_on while paid_out_on is still
--      set. log_project_tranche_activity() (023_tranche_confirmed.sql)
--      is rebuilt to describe a paid_out_on change too ("Tranche N
--      paid out on …" / "payout cleared") — note *only*, never an
--      amount, alongside its existing confirmed_on handling; the two
--      are independent and can each produce their own activity_log
--      row in the same update if both changed together.
--   2. payout_groups — admin-managed list (name, default_share_pct,
--      active, sort_order), seeded with the five current groups at an
--      even 20% default each. Same shape as products/document_types/
--      statuses (011_settings_tables.sql, 019_statuses.sql), but never
--      activity-logged — see the note on point 5 below.
--   3. tranche_payouts — one row per tranche that has its commission
--      worked out (our_pct, notes); a paid-out tranche with no row
--      here yet is what the app shows as "Commission not set", not a
--      zero or a null our_pct.
--   4. tranche_payout_shares — the group split for one tranche_payouts
--      row (share_pct = that group's % of OUR commission, not of the
--      deal). unique (tranche_payout_id, group_id) so each group
--      appears at most once per tranche.
--   5. RLS on payout_groups, tranche_payouts and tranche_payout_shares
--      is admin-only for every operation (select included) — a member
--      must not be able to read them at all, let alone see a
--      percentage or an amount. None of the three get an activity_log
--      trigger: payout figures must never end up in activity_log (or
--      anywhere else a member can reach, like search). No new
--      activity_log entity_type is introduced by this migration at
--      all, so activity_log_entity_type_check is untouched.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. project_tranches.paid_out_on
-- ----------------------------------------------------------------------------

alter table public.project_tranches
  add column if not exists paid_out_on date;

alter table public.project_tranches
  drop constraint if exists project_tranches_paid_out_requires_confirmed;

alter table public.project_tranches
  add constraint project_tranches_paid_out_requires_confirmed
  check (paid_out_on is null or (confirmed_on is not null and paid_out_on >= confirmed_on));

create or replace function public.log_project_tranche_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $log_project_tranche_activity$
declare
  v_actor_id uuid;
  v_actor_label text;
  v_old_confirmed_on date;
  v_old_paid_out_on date;
  v_confirmed_changed boolean;
  v_paid_out_changed boolean;
begin
  if tg_op = 'INSERT' then
    v_old_confirmed_on := null;
    v_old_paid_out_on := null;
    v_confirmed_changed := new.confirmed_on is not null;
    v_paid_out_changed := new.paid_out_on is not null;
  elsif tg_op = 'UPDATE' then
    v_old_confirmed_on := old.confirmed_on;
    v_old_paid_out_on := old.paid_out_on;
    v_confirmed_changed := new.confirmed_on is distinct from old.confirmed_on;
    v_paid_out_changed := new.paid_out_on is distinct from old.paid_out_on;
  else
    return null;
  end if;

  if not v_confirmed_changed and not v_paid_out_changed then
    return null;
  end if;

  select a.actor_id, a.actor_label into v_actor_id, v_actor_label from public.activity_actor() a;

  if v_confirmed_changed then
    insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
    values (
      'project_tranche',
      new.id,
      'updated',
      case
        when new.confirmed_on is not null then
          'Tranche ' || new.tranche_number || ' confirmed on ' || to_char(new.confirmed_on, 'YYYY-MM-DD')
        else
          'Tranche ' || new.tranche_number || ' confirmation cleared'
      end,
      jsonb_build_object(
        'parent_type', 'project',
        'parent_id', new.project_id,
        'tranche_number', new.tranche_number,
        'confirmed_on', jsonb_build_array(v_old_confirmed_on, new.confirmed_on)
      ),
      v_actor_id,
      v_actor_label
    );
  end if;

  if v_paid_out_changed then
    insert into public.activity_log (entity_type, entity_id, action, summary, details, actor_id, actor_label)
    values (
      'project_tranche',
      new.id,
      'updated',
      case
        when new.paid_out_on is not null then
          'Tranche ' || new.tranche_number || ' paid out on ' || to_char(new.paid_out_on, 'YYYY-MM-DD')
        else
          'Tranche ' || new.tranche_number || ' payout cleared'
      end,
      jsonb_build_object(
        'parent_type', 'project',
        'parent_id', new.project_id,
        'tranche_number', new.tranche_number,
        'paid_out_on', jsonb_build_array(v_old_paid_out_on, new.paid_out_on)
      ),
      v_actor_id,
      v_actor_label
    );
  end if;

  return null;
end;
$log_project_tranche_activity$;

drop trigger if exists project_tranches_log_activity on public.project_tranches;
create trigger project_tranches_log_activity
  after insert or update on public.project_tranches
  for each row
  execute function public.log_project_tranche_activity();

revoke all on function public.log_project_tranche_activity() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. payout_groups
-- ----------------------------------------------------------------------------

create table if not exists public.payout_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_share_pct numeric(6, 2) not null default 0 check (default_share_pct >= 0 and default_share_pct <= 100),
  active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payout_groups enable row level security;

insert into public.payout_groups (name, default_share_pct, sort_order) values
  ('Kiara', 20, 1),
  ('Miguel', 20, 2),
  ('Abel', 20, 3),
  ('Francisco', 20, 4),
  ('Carlos & Jackie', 20, 5)
on conflict (name) do nothing;

drop policy if exists "payout_groups_select_admin" on public.payout_groups;
create policy "payout_groups_select_admin"
  on public.payout_groups for select
  to authenticated
  using (public.is_registered_user() and public.is_admin());

drop policy if exists "payout_groups_insert_admin" on public.payout_groups;
create policy "payout_groups_insert_admin"
  on public.payout_groups for insert
  to authenticated
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "payout_groups_update_admin" on public.payout_groups;
create policy "payout_groups_update_admin"
  on public.payout_groups for update
  to authenticated
  using (public.is_registered_user() and public.is_admin())
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "payout_groups_delete_admin" on public.payout_groups;
create policy "payout_groups_delete_admin"
  on public.payout_groups for delete
  to authenticated
  using (public.is_registered_user() and public.is_admin());

drop trigger if exists payout_groups_set_updated_at on public.payout_groups;
create trigger payout_groups_set_updated_at
  before update on public.payout_groups
  for each row
  execute function public.set_updated_at_only();

-- ----------------------------------------------------------------------------
-- 3. tranche_payouts
-- ----------------------------------------------------------------------------

create table if not exists public.tranche_payouts (
  id uuid primary key default gen_random_uuid(),
  tranche_id uuid not null unique references public.project_tranches (id) on delete cascade,
  our_pct numeric(9, 4) check (our_pct is null or our_pct >= 0),
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.tranche_payouts enable row level security;

drop policy if exists "tranche_payouts_select_admin" on public.tranche_payouts;
create policy "tranche_payouts_select_admin"
  on public.tranche_payouts for select
  to authenticated
  using (public.is_registered_user() and public.is_admin());

drop policy if exists "tranche_payouts_insert_admin" on public.tranche_payouts;
create policy "tranche_payouts_insert_admin"
  on public.tranche_payouts for insert
  to authenticated
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "tranche_payouts_update_admin" on public.tranche_payouts;
create policy "tranche_payouts_update_admin"
  on public.tranche_payouts for update
  to authenticated
  using (public.is_registered_user() and public.is_admin())
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "tranche_payouts_delete_admin" on public.tranche_payouts;
create policy "tranche_payouts_delete_admin"
  on public.tranche_payouts for delete
  to authenticated
  using (public.is_registered_user() and public.is_admin());

drop trigger if exists tranche_payouts_set_updated_at on public.tranche_payouts;
create trigger tranche_payouts_set_updated_at
  before update on public.tranche_payouts
  for each row
  execute function public.set_updated_at_only();

-- ----------------------------------------------------------------------------
-- 4. tranche_payout_shares
-- ----------------------------------------------------------------------------

create table if not exists public.tranche_payout_shares (
  id uuid primary key default gen_random_uuid(),
  tranche_payout_id uuid not null references public.tranche_payouts (id) on delete cascade,
  group_id uuid not null references public.payout_groups (id),
  share_pct numeric(6, 2) not null check (share_pct >= 0 and share_pct <= 100),
  unique (tranche_payout_id, group_id)
);

alter table public.tranche_payout_shares enable row level security;

drop policy if exists "tranche_payout_shares_select_admin" on public.tranche_payout_shares;
create policy "tranche_payout_shares_select_admin"
  on public.tranche_payout_shares for select
  to authenticated
  using (public.is_registered_user() and public.is_admin());

drop policy if exists "tranche_payout_shares_insert_admin" on public.tranche_payout_shares;
create policy "tranche_payout_shares_insert_admin"
  on public.tranche_payout_shares for insert
  to authenticated
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "tranche_payout_shares_update_admin" on public.tranche_payout_shares;
create policy "tranche_payout_shares_update_admin"
  on public.tranche_payout_shares for update
  to authenticated
  using (public.is_registered_user() and public.is_admin())
  with check (public.is_registered_user() and public.is_admin());

drop policy if exists "tranche_payout_shares_delete_admin" on public.tranche_payout_shares;
create policy "tranche_payout_shares_delete_admin"
  on public.tranche_payout_shares for delete
  to authenticated
  using (public.is_registered_user() and public.is_admin());

commit;

-- ============================================================================
-- Migration 022: ARK Inbox via Telegram bot
--
-- Run this manually in the Supabase SQL editor, after 001_ark_schema.sql
-- through 021_tranche_documents.sql have already been applied. Safe to
-- re-run — every statement uses IF EXISTS/IF NOT EXISTS, DROP ... IF
-- EXISTS before CREATE, or ON CONFLICT DO NOTHING.
--
--   1. profiles.telegram_user_id — a user's own numeric Telegram id
--      (from @userinfobot), set by themselves in Settings → My
--      Profile. Unique when set (Postgres treats multiple NULLs as
--      distinct, so this is "unique among users who've set one", not
--      "exactly one row may have NULL").
--   2. inbox_items — one row per inbound Telegram message from a
--      recognized, active ARK user (matched by telegram_user_id in the
--      webhook, app/api/telegram/inbox/route.ts). telegram_update_id is
--      unique for dedupe (Telegram can redeliver the same update).
--      filed_to_type/filed_to_id together describe "filed into project
--      X" / "filed into receiver Y" — kept as history once status
--      moves to 'filed', never deleted; there's no plain FK on
--      filed_to_id since it points at one of two different tables
--      depending on filed_to_type. "Too large for Telegram" isn't its
--      own column: it's inferred in the app as kind <> 'text' and
--      storage_path is null (we always attempt a download otherwise,
--      so the only other way to end up here is a download that
--      genuinely failed — rare enough not to warrant its own flag).
--   3. A new private "inbox" storage bucket, same allowed types and 50
--      MB limit as project-documents/contact-documents. RLS lets a
--      registered user read and delete objects in it (to preview, or
--      clean up after filing/dismissing/deleting an item) but never
--      create one — every file in it is written by the webhook's
--      service-role client, which bypasses storage RLS entirely, same
--      as inbox_items itself below.
--
--   No new activity_log entity_type is introduced here — filing an
--   item creates an ordinary project_document/contact_document/note
--   row, already covered by its own existing trigger — so
--   activity_log_entity_type_check is untouched.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. profiles.telegram_user_id
-- ----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists telegram_user_id bigint;

alter table public.profiles
  drop constraint if exists profiles_telegram_user_id_key;

alter table public.profiles
  add constraint profiles_telegram_user_id_key unique (telegram_user_id);

-- ----------------------------------------------------------------------------
-- 2. inbox_items
-- ----------------------------------------------------------------------------

create table if not exists public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  telegram_update_id bigint not null,
  profile_id uuid references public.profiles (id) on delete set null,
  received_at timestamptz not null default now(),
  kind text not null check (kind in ('text', 'document', 'photo', 'video')),
  text_or_caption text,
  forwarded_from text,
  file_name text,
  mime_type text,
  file_size bigint,
  storage_path text,
  status text not null default 'new' check (status in ('new', 'filed', 'dismissed')),
  filed_to_type text check (filed_to_type in ('project', 'contact')),
  filed_to_id uuid,
  media_group_id text,
  constraint inbox_items_filed_to_consistent check (
    (filed_to_type is null and filed_to_id is null) or (filed_to_type is not null and filed_to_id is not null)
  )
);

create unique index if not exists inbox_items_telegram_update_id_key on public.inbox_items (telegram_update_id);
create index if not exists inbox_items_status_idx on public.inbox_items (status);
create index if not exists inbox_items_profile_id_idx on public.inbox_items (profile_id);
create index if not exists inbox_items_received_at_idx on public.inbox_items (received_at desc);

alter table public.inbox_items enable row level security;

drop policy if exists "inbox_items_select_registered" on public.inbox_items;
create policy "inbox_items_select_registered"
  on public.inbox_items for select
  to authenticated
  using (public.is_registered_user());

drop policy if exists "inbox_items_update_registered" on public.inbox_items;
create policy "inbox_items_update_registered"
  on public.inbox_items for update
  to authenticated
  using (public.is_registered_user())
  with check (public.is_registered_user());

drop policy if exists "inbox_items_delete_registered" on public.inbox_items;
create policy "inbox_items_delete_registered"
  on public.inbox_items for delete
  to authenticated
  using (public.is_registered_user());

-- Deliberately no INSERT policy for authenticated/anon: every row is
-- created by the webhook via the service-role client (lib/supabase/
-- service.ts's createServiceClient), which bypasses RLS entirely
-- regardless of what policies exist for the `authenticated` role.

-- ----------------------------------------------------------------------------
-- 3. storage bucket "inbox"
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inbox',
  'inbox',
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

drop policy if exists "inbox_bucket_select_registered" on storage.objects;
create policy "inbox_bucket_select_registered"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'inbox'
    and public.is_registered_user()
  );

drop policy if exists "inbox_bucket_delete_registered" on storage.objects;
create policy "inbox_bucket_delete_registered"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'inbox'
    and public.is_registered_user()
  );

-- Deliberately no INSERT/UPDATE policy on storage.objects for bucket
-- 'inbox' either, for the same reason as inbox_items above: only the
-- webhook's service-role client ever writes a file there.

commit;

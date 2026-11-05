<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ARK

ARK is a private, two-user tracker for banking-product client projects. It is a from-scratch rebrand of an internal CRM template — no part of it is affiliated with, or should ever reference, that template's original owner, branding, or business lines.

## What ARK tracks

Projects run on a banking product — SBLC, MX103, MT103, IP-IP, API, API Cash, T2T, S2S, VISA, GPI, KTK are the ones seeded by default, but the list itself is admin-managed data now, not a fixed set: see **Settings** below. There is no "business line" concept in ARK.

A project moves through four **stages** — New, Documents Received, Match, Status — and once it reaches Status it also carries a **status**: Open, With Receiver, With Sender, Waiting, In Process, Completed, Lost (`lib/projects.ts`). A project has a Client Contact and an Assigned Contact (both ordinary Contacts, not internal users), Ratio Presented/Ratio Real (free text, e.g. "70/30"), a Total Face Value + currency — all manual entry, no profit field, no formulas.

## Modules

- **Projects** (`app/(app)/projects`, `lib/projects.ts`, `lib/actions/projects.ts`) — the core pipeline.
- **Timeline** (`project_steps` table, `lib/actions/project-steps.ts`, `components/projects/project-timeline.tsx`) — replaces the old per-project Notes section on the project detail page. Three entry kinds: **step taken**, **next step** (carries a `due_date`), and a plain **note**. Open next steps (not yet done) are pinned at the top, earliest due date first; everything else — step-taken, plain notes, and next steps once checked off — lives in the full history below, newest first. Checking a next step's "Done" box sets `done`/`done_at` and moves it into history with a strikethrough; unticking reverses it. Every entry supports inline edit and delete (delete asks for confirmation). Due dates are colored by `lib/projects.ts`'s `dueDateTone()`: red = overdue, amber = due today, neutral = upcoming — shared with the Projects list's "Next Step" column and the Dashboard's Follow-ups Due section.
- **Tranches** — each project has Tranche 1 and 2 always visible on its detail page, plus a "Tranches after" flow to add 3, 4, …; each tranche has a manual amount and a "sent on" date (empty = not sent). `project_tranches` table, `components/projects/tranches-section.tsx`.
- **Contacts** (`app/(app)/contacts`) — people linked to projects, with free-text capability tags.
- **Notes** (`app/(app)/notes`) — free-form notes and reminders, optionally linked to a contact (or nothing — notes no longer link to projects; a project's own activity lives in its Timeline instead).
- **Activity** (`app/(app)/activity`, `lib/activity.ts`) — an audit log of created/updated/deleted rows across projects, contacts, documents, and timeline entries.
- **Documents** — file upload with SHA-256 duplicate detection, attached to a project (`lib/storage.ts`, `lib/actions/projects.ts`). Document types — CIS, POF, DOA, PGL, JSON, Proof of Fulfillment, Supporting Documents, Additional Documents are the seeded defaults — are admin-managed data; see **Settings** below.
- **Global search** (`components/global-search.tsx`, `lib/search.ts`) — searches projects, contacts, and documents.
- **Dashboard** (`app/(app)/dashboard`) — Follow-ups Due (open next steps due today or overdue, across every non-archived project, with a Done checkbox right there) and Stuck Projects (open, non-archived, non-closed projects with no activity in 7+ days, oldest first — the threshold comes from Settings → Defaults).
- **Settings** (`app/(app)/settings`) — **Products** and **Document Types** (admin only): Add, Rename, Hide/Show, and reorder. These replaced the old hard-coded `PRODUCT_TYPES`/`DOCUMENT_TYPES` lists — both are now rows in the `products`/`document_types` tables (`lib/products.ts`, `lib/document-types.ts`, `lib/actions/catalog.ts`), read by every dropdown, filter, and the Dashboard's product breakdown. Hiding an item removes it from *new-entry* pickers only — existing projects/contacts/documents that already use it keep displaying and filtering correctly; nothing is ever deleted, only hidden. Renaming cascades automatically (`ON UPDATE CASCADE` on the FK from `projects.product_type`/`contact_products.product_type`/`project_documents.document_type`/`contact_documents.document_type`). **Defaults** (admin only): default currency for new projects, and the Dashboard's "stuck after N days" threshold (`app_settings`, a single-row table, `lib/app-settings.ts`). **My Profile** (everyone): display name. A user's `role` column (`admin`/`member`/null, gated by `is_admin()`) is what the first three sections check — only an admin sees them, and a non-admin can never change their own role through the app (enforced by a DB trigger, not just UI).

Duplicate detection (same client contact + product type) is a **warning only** — one client can have several deals of the same product, so it never blocks a save; "Add anyway" always works.

## Database

The real ARK schema lives in `supabase/migrations/001_ark_schema.sql` — run it once, by hand, in the ARK project's Supabase SQL editor. `supabase/verify_ark.sql` has read-only checks to run afterwards (RLS enabled everywhere, no policy grants to `anon`, the `project-documents` bucket exists and is private). Everything under `supabase/_jes3_archive/` is the history of the template this app was copied from — it was never run against ARK's database and never will be; it's kept only as reference.

Every table uses the same pattern: RLS enabled, policies gated on `is_registered_user()` (a Supabase Auth user becomes "registered" only once they have a `profiles` row — the app creates it on first login). For a private two-user tool, that means signups must also be disabled at the Supabase Auth level; `is_registered_user()` is the second lock on the door, not the first.

Do not run database commands or migrations outside of a deliberate, reviewed step like this one.

## Removed from the template

Telegram integration, the Procedures module (and procedure-to-lead matching), wallets/crypto fields, and all non-banking business lines (crypto, gold, PGM, oil products) were removed in Phase 1. The old `leads`-table field set (`procedure_type`, `deal_value`, `source`, `follow_up_date`, `assigned_to`→profiles, `stage_updated_at`, boolean `archived`) was replaced in Phase 2 by the field set described above. Kept throughout: Contacts, Notes, document upload with duplicate detection, global search, activity log, mobile layouts, login.

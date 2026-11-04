<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ARK

ARK is a private, two-user tracker for banking-product client projects. It is a from-scratch rebrand of an internal CRM template — no part of it is affiliated with, or should ever reference, that template's original owner, branding, or business lines.

## What ARK tracks

Projects run on one of these banking products: **SBLC, MX103, MT103, IP-IP, API, T2T, S2S** (`lib/products.ts`, a fixed list kept in sync by hand with the `product_type` enum in the schema — adding an 8th product is a code change, not a user-entered value). There is no "business line" concept in ARK.

A project moves through four **stages** — New, Documents Received, Match, Status — and once it reaches Status it also carries a **status**: Open, With Receiver, With Sender, Waiting, In Process, Completed, Lost (`lib/projects.ts`). A project has a Client Contact and an Assigned Contact (both ordinary Contacts, not internal users), Ratio Presented/Ratio Real (free text, e.g. "70/30"), a Total Face Value + currency — all manual entry, no profit field, no formulas.

## Modules

- **Projects** (`app/(app)/projects`, `lib/projects.ts`, `lib/actions/projects.ts`) — the core pipeline.
- **Tranches** — each project has Tranche 1 and 2 always visible on its detail page, plus a "Tranches after" flow to add 3, 4, …; each tranche has a manual amount and a "sent on" date (empty = not sent). `project_tranches` table, `components/projects/tranches-section.tsx`.
- **Contacts** (`app/(app)/contacts`) — people linked to projects, with free-text capability tags.
- **Notes** (`app/(app)/notes`) — free-form notes and reminders, optionally linked to a project or contact.
- **Activity** (`app/(app)/activity`, `lib/activity.ts`) — an audit log of created/updated/deleted rows across projects, contacts, and documents.
- **Documents** — file upload with SHA-256 duplicate detection, attached to a project (`lib/storage.ts`, `lib/actions/projects.ts`). Document types: CIS, POF, DOA, PGL, JSON, Proof of Fulfillment, Supporting Documents, Additional Documents.
- **Global search** (`components/global-search.tsx`, `lib/search.ts`) — searches projects, contacts, and documents.
- **Project Steps** (`project_steps` table only — no UI yet) — the Phase 3 timeline: step-taken / next-step / note entries per project. See the TODO below.

Duplicate detection (same client contact + product type) is a **warning only** — one client can have several deals of the same product, so it never blocks a save; "Add anyway" always works.

## Database

The real ARK schema lives in `supabase/migrations/001_ark_schema.sql` — run it once, by hand, in the ARK project's Supabase SQL editor. `supabase/verify_ark.sql` has read-only checks to run afterwards (RLS enabled everywhere, no policy grants to `anon`, the `project-documents` bucket exists and is private). Everything under `supabase/_jes3_archive/` is the history of the template this app was copied from — it was never run against ARK's database and never will be; it's kept only as reference.

Every table uses the same pattern: RLS enabled, policies gated on `is_registered_user()` (a Supabase Auth user becomes "registered" only once they have a `profiles` row — the app creates it on first login). For a private two-user tool, that means signups must also be disabled at the Supabase Auth level; `is_registered_user()` is the second lock on the door, not the first.

Do not run database commands or migrations outside of a deliberate, reviewed step like this one.

## TODO — Phase 3

- **Project Steps timeline UI**: a page/section to log step-taken / next-step / note entries against a project (`project_steps` table already exists).
- **Rebuild the Dashboard's Stuck Deals and Follow-ups Due**, removed in Phase 2 because their old backing fields (`stage_updated_at`, `follow_up_date`) no longer exist:
  - **Follow-ups Due** ← `project_steps` rows where `kind = 'next_step'` and `due_date` has arrived.
  - **Stuck Deals** ← projects where `last_activity_at` is 7+ days in the past (not yet archived/completed).

## Removed from the template

Telegram integration, the Procedures module (and procedure-to-lead matching), wallets/crypto fields, and all non-banking business lines (crypto, gold, PGM, oil products) were removed in Phase 1. The old `leads`-table field set (`procedure_type`, `deal_value`, `source`, `follow_up_date`, `assigned_to`→profiles, `stage_updated_at`, boolean `archived`) was replaced in Phase 2 by the field set described above. Kept throughout: Contacts, Notes, document upload with duplicate detection, global search, activity log, mobile layouts, login.

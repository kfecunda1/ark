<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ARK

ARK is a private, two-user tracker for banking-product client projects. It is a from-scratch rebrand of an internal CRM template — no part of it is affiliated with, or should ever reference, that template's original owner, branding, or business lines.

## What ARK tracks

Projects run on one of these banking products: **SBLC, MX103, MT103, IP-IP, API, T2T, S2S** (`lib/products.ts`, a fixed list — adding an 8th product is a code change, not a user-entered value). There is no "business line" concept in ARK; it existed in the template this app was copied from and has been fully removed from the UI and types.

## Modules

- **Projects** (`app/(app)/projects`, `lib/projects.ts`, `lib/actions/projects.ts`) — the core pipeline: product type, procedure type, priority, stage, contacts, deal value, documents.
- **Contacts** (`app/(app)/contacts`) — people linked to projects, with free-text capability tags.
- **Notes** (`app/(app)/notes`) — free-form notes and reminders, optionally linked to a project or contact.
- **Activity** (`app/(app)/activity`, `lib/activity.ts`) — an audit log of created/updated/deleted rows across projects, contacts, and documents.
- **Documents** — file upload with SHA-256 duplicate detection, attached to a project (`lib/storage.ts`, `lib/actions/projects.ts`).
- **Global search** (`components/global-search.tsx`, `lib/search.ts`) — searches projects, contacts, and documents.

## Database — a two-phase migration

ARK's Supabase database is a **brand-new, empty project**. It does **not** have the schema the `supabase/migrations/*.sql` files describe — those migrations are the history of the template this app was copied from, kept in the repo only as reference, not as ARK's actual schema.

- **Phase 1** (done): stripped the app down to Projects/Contacts/Notes/Documents/Activity/Search and rebranded it, without touching the database at all. The code still reads/writes legacy identifiers (`leads` table, `lead_id`, `lead-documents` bucket, etc.) so it has something to run against once Phase 2 lands.
- **Phase 2** (not yet done): write a fresh, ARK-native schema — a `projects` table (no `business_line`, no wallets, no `procedures` table, no Telegram tables) — and apply it to the actual ARK database. Renaming `leads` → `projects`, `lead_id` → `project_id`, etc. at the code level happens together with that migration, not before it.

Do not run database commands or migrations outside of that deliberate Phase 2 step.

## Removed from the template

Telegram integration, the Procedures module (and procedure-to-lead matching), wallets/crypto fields, and all non-banking business lines (crypto, gold, PGM, oil products) were removed in Phase 1. Kept: Contacts, Notes, document upload with duplicate detection, global search, activity log, mobile layouts, login.

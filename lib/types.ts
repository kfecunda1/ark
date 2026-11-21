// Was a fixed literal union; now admin-managed data (supabase/migrations/
// 011_settings_tables.sql's `products` table, see lib/products.ts) — any
// current product name is valid, so this is just `string` now.
export type ProductType = string;

// One row of the `products` table (Settings → Products, admin only).
// Hiding a product sets active = false rather than deleting it, so
// existing projects/contacts that reference it keep displaying
// correctly — only *new* entries stop offering it.
export interface Product {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type ProjectStage = "new" | "documents_received" | "match" | "status";

// Was a fixed literal union; now admin-managed data (supabase/
// migrations/019_statuses.sql's `statuses` table, see lib/statuses.ts)
// — any current status name is valid, so this is just `string` now.
export type ProjectStatus = string;

// The fixed ~8-value badge-color palette a status can be assigned —
// see components/projects/badges.tsx's STATUS_COLOR_STYLES for what
// each one actually looks like.
export type StatusColor = "accent" | "cyan" | "teal" | "silver" | "sky" | "emerald" | "amber" | "rose";

// One row of the `statuses` table (Settings → Statuses, admin only).
// Same hide-don't-delete behavior as Product: hiding a status sets
// active = false rather than deleting it, so existing projects that
// reference it keep displaying and filtering correctly — only *new*
// entries stop offering it. `kind` is what every "is this project
// open/completed/lost?" check (the dashboard's open/stuck/completed
// counts, isClosedStatus) now reads, instead of comparing against a
// hard-coded status name — a status can be renamed freely without
// breaking that logic.
export interface StatusRecord {
  id: string;
  name: string;
  kind: "open" | "completed" | "lost";
  color: StatusColor;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// One row of the `payout_groups` table (Settings → Groups, admin
// only — supabase/migrations/025_payouts.sql). Same hide-don't-delete
// shape as Product/StatusRecord above. default_share_pct pre-fills a
// new tranche_payout_shares row for this group; it's never read back
// once a share has actually been saved for a given tranche.
export interface PayoutGroup {
  id: string;
  name: string;
  default_share_pct: number;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// One row per tranche whose commission has been worked out
// (supabase/migrations/025_payouts.sql) — a paid-out tranche with no
// row here yet (or one with our_pct still null) is what the Payouts
// page shows as "Commission not set", not a zero. Admin-only RLS, and
// deliberately never activity-logged — see AGENTS.md/the migration's
// own comment on why.
export interface TranchePayout {
  id: string;
  tranche_id: string;
  our_pct: number | null;
  notes: string | null;
  updated_at: string;
}

// share_pct is this group's % of OUR commission (not of the deal) —
// see TranchePayout above.
export interface TranchePayoutShare {
  id: string;
  tranche_payout_id: string;
  group_id: string;
  share_pct: number;
}

export type ProjectPriority = "low" | "medium" | "high" | "urgent";

export type Currency = "USD" | "EUR";

// Concrete role an admin assigns through Settings → Users
// (lib/actions/users.ts) — unlike Profile.role below, never null.
export type UserRole = "admin" | "member";

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  // Null until an admin assigns one (or for a profile auto-provisioned
  // by a first login that predates Settings → Users — see
  // app/login/page.tsx's ensureProfile).
  role: UserRole | null;
  // supabase/migrations/012_user_management.sql. Deactivating a user
  // sets this false, which is enough on its own to cut off all their
  // data access everywhere (is_registered_user() requires it) —
  // nothing else needs to check it directly.
  active: boolean;
  // True right after an admin creates the account or resets its
  // password; cleared automatically the moment the user successfully
  // changes their own password (components/settings/change-password-
  // form.tsx). While true, app/change-password/page.tsx is the only
  // page they can reach (lib/supabase/proxy.ts enforces this).
  must_change_password: boolean;
  // supabase/migrations/022_telegram_inbox.sql. Set by the user
  // themselves in Settings → My Profile; the Telegram webhook (app/api/
  // telegram/inbox/route.ts) matches an inbound message's from.id
  // against this to decide whose Inbox it belongs to.
  telegram_user_id: number | null;
}

// supabase/migrations/022_telegram_inbox.sql.
export type InboxItemKind = "text" | "document" | "photo" | "video";
export type InboxItemStatus = "new" | "filed" | "dismissed";
export type InboxFiledToType = "project" | "contact";

// "Too large for Telegram" has no column of its own — see lib/inbox.ts's
// isTooLargeForTelegram for how it's derived (from file_size, not
// storage_path — storage_path alone was the bug, see 027_inbox_view.sql).
export interface InboxItem {
  id: string;
  telegram_update_id: number;
  profile_id: string | null;
  received_at: string;
  kind: InboxItemKind;
  text_or_caption: string | null;
  forwarded_from: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  storage_path: string | null;
  status: InboxItemStatus;
  filed_to_type: InboxFiledToType | null;
  filed_to_id: string | null;
  media_group_id: string | null;
  // supabase/migrations/027_inbox_view.sql. filed_by/filed_at describe
  // the filing action itself (who/when) — distinct from profile_id/
  // received_at, which describe the original Telegram message.
  // filed_document_id is the project_documents/contact_documents row
  // this became when filed as a Document (null for a Note, or when
  // not yet filed) — which table to look it up in is implied by
  // filed_to_type.
  filed_by: string | null;
  filed_at: string | null;
  filed_document_id: string | null;
}

export interface Contact {
  id: string;
  created_at: string;
  full_name: string;
  notes: string | null;
  // supabase/migrations/016_receivers_and_people.sql. Optional link to
  // a `people` row — the UI's "Contacts" tab (not the same thing as
  // this Contact — see AGENTS.md's UI-naming-vs-database-naming note:
  // in the UI, this whole table/type is "Receivers").
  contact_person_id: string | null;
  // supabase/migrations/017_archive_receivers_people.sql. null = active,
  // same "null means active" convention as projects.archived_at.
  archived_at: string | null;
}

// supabase/migrations/016_receivers_and_people.sql. The real, simple
// person record behind the UI's "Contacts" tab — deliberately named
// `people`/`Person`, never `contacts`/`Contact`, so it can't collide
// with the existing (UI: Receivers) table of that name.
export interface Person {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
  // supabase/migrations/017_archive_receivers_people.sql. null = active.
  archived_at: string | null;
}

// supabase/migrations/018_intermediaries.sql. Which `people` are an
// intermediary for a given Receiver — an unordered set (shown on the
// Receiver page with how many of its projects each one appears in),
// unlike ProjectIntermediary below.
export interface ReceiverIntermediary {
  id: string;
  receiver_id: string;
  person_id: string;
  created_at: string;
}

// supabase/migrations/018_intermediaries.sql. A project's own ordered
// intermediary chain ("Name -> Name -> <Receiver>"), 1-based `position`
// per project.
export interface ProjectIntermediary {
  id: string;
  project_id: string;
  person_id: string;
  position: number;
  created_at: string;
}

// One row per product a contact handles. Unique (contact_id,
// product_type) — a contact has at most one ratio on record per
// product.
export interface ContactProduct {
  id: string;
  contact_id: string;
  product_type: ProductType;
  ratio: string | null;
  // supabase/migrations/015_recovery.sql — the ratio that applies when
  // a project using this product is flagged Recovery (projects.
  // is_recovery), parallel to `ratio` for the non-recovery case.
  recovery_ratio: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  stage: ProjectStage;
  // Only meaningful once stage === "status" — the DB enforces "required
  // when stage = status" but not the reverse, so this can still be set
  // from an earlier visit to the Status stage.
  status: ProjectStatus | null;
  ratio_presented: string | null;
  ratio_real: string | null;
  total_face_value: number | null;
  currency: Currency;
  priority: ProjectPriority;
  // null = active. A timestamp = archived (and when).
  archived_at: string | null;
  last_activity_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // The only contact a project carries (supabase/migrations/013_
  // projects_restructure.sql dropped client_contact_id and
  // assigned_contact_id) — also what the ratio auto-fill
  // (components/projects/project-form.tsx) reads from.
  matched_contact_id: string | null;
  // Null until exactly one project_products option exists (auto-set)
  // or someone picks one via "Choose as final" / "Make final instead"
  // — see components/projects/project-product-options.tsx. Always one
  // of this project's own project_products.product values; enforced by
  // the validate_final_product DB trigger, not just the app.
  final_product: string | null;
  // supabase/migrations/015_recovery.sql. Switches which of the
  // matched contact's ratios the auto-fill reads (recovery_ratio
  // instead of ratio) — see lib/actions/contacts.ts's
  // getContactProductRatio(s).
  is_recovery: boolean;
  // supabase/migrations/016_receivers_and_people.sql. Optional link to
  // a `people` row — independent of matched_contact_id (a Receiver),
  // which is a wholly separate relationship.
  contact_person_id: string | null;
}

// A project's 1-3 product options (supabase/migrations/013_projects_
// restructure.sql). sort_order reflects the order they were added in —
// display order, not a ranking.
export interface ProjectProduct {
  id: string;
  project_id: string;
  product: string;
  sort_order: number;
  created_at: string;
}

// Tranche 1 and 2 are permanent slots the UI always shows, even with no
// row here yet (see components/projects/tranches-section.tsx); 3+ are
// added on demand. sent_on null means not sent yet.
// confirmed_on (supabase/migrations/023_tranche_confirmed.sql) can only
// be set alongside sent_on, and never before it — enforced by a check
// constraint, not just the app. paid_out_on (025_payouts.sql) is the
// same idea one step further: it can only be set alongside
// confirmed_on, and never before it.
export interface ProjectTranche {
  id: string;
  project_id: string;
  tranche_number: number;
  amount: number | null;
  sent_on: string | null;
  notes: string | null;
  confirmed_on: string | null;
  paid_out_on: string | null;
  created_at: string;
}

// Was a fixed literal union; now admin-managed data (supabase/migrations/
// 011_settings_tables.sql's `document_types` table, see
// lib/document-types.ts) — any current document type name is valid, so
// this is just `string` now.
export type ProjectDocumentType = string;

// One row of the `document_types` table (Settings → Document Types,
// admin only). Same hide-don't-delete behavior as Product above.
export interface DocumentTypeRecord {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// file_path/url are mutually exclusive (supabase/migrations/020_media_
// uploads.sql's check constraint): an uploaded file has file_path set and
// url null; a link to a file kept elsewhere (e.g. Google Drive) has url
// set and file_path null, with file_name holding the name the user gave
// it.
// tranche_id null means "General" — not attached to any tranche
// (supabase/migrations/021_tranche_documents.sql). FK is ON DELETE SET
// NULL, so removing a tranche moves its documents back to General
// rather than deleting them.
export interface ProjectDocument {
  id: string;
  project_id: string;
  document_type: ProjectDocumentType;
  file_path: string | null;
  file_name: string;
  file_hash: string | null;
  url: string | null;
  tranche_id: string | null;
  created_at: string;
}

// Same DB enum as ProjectDocumentType (supabase/migrations/003_contacts_
// upgrade.sql's contact_documents.document_type reuses the
// project_document_type Postgres type directly) — aliased here only so
// contact-side code reads as its own domain.
export type ContactDocumentType = ProjectDocumentType;

// Same shape as ProjectDocument, owned by a contact instead of a
// project.
export interface ContactDocument {
  id: string;
  contact_id: string;
  document_type: ContactDocumentType;
  file_path: string | null;
  file_name: string;
  file_hash: string | null;
  url: string | null;
  created_at: string;
}

// The project timeline (components/projects/project-timeline.tsx),
// replacing the old per-project Notes section. "note" was a legal kind
// here through migration 013; migration 014 moved notes onto the notes
// table (see Note below) and nothing writes kind "note" anymore.
export type ProjectStepKind = "step_taken" | "next_step";

export interface ProjectStep {
  id: string;
  project_id: string;
  kind: ProjectStepKind;
  body: string;
  due_date: string | null;
  done: boolean;
  // Set when done is flipped to true, cleared when flipped back — see
  // supabase/migrations/004_timeline.sql.
  done_at: string | null;
  author_id: string | null;
  created_at: string;
}

// supabase/migrations/014_notes_projects_reminders.sql re-added
// project_id - a note links to a project, a contact, or nothing.
export interface Note {
  id: string;
  created_at: string;
  created_by: string | null;
  title: string | null;
  content: string;
  is_reminder: boolean;
  due_date: string | null;
  reminded_at: string | null;
  reminder_done: boolean;
  project_id: string | null;
  contact_id: string | null;
}

// The app_settings table is a single row (see supabase/migrations/
// 011_settings_tables.sql's `id boolean primary key check (id)`
// singleton trick) — there's exactly one, so no id-based lookup is
// needed; lib/app-settings.ts fetches it directly.
export interface AppSettings {
  default_currency: Currency;
  stuck_after_days: number;
  // supabase/migrations/024_show_recovery.sql — Settings → Defaults'
  // "Show Recovery" toggle. Purely a display switch: off hides
  // recovery features throughout the app, but changes nothing about
  // any project's own is_recovery value or data.
  show_recovery: boolean;
  updated_at: string;
}

export type ActivityEntityType =
  | "project"
  | "contact"
  | "project_document"
  | "contact_product"
  | "contact_document"
  | "project_step"
  | "backup"
  | "password_change"
  | "product"
  | "document_type"
  | "app_settings"
  | "user"
  | "project_product"
  | "note"
  | "person"
  | "receiver_intermediary"
  | "project_intermediary"
  | "status"
  | "project_tranche";

export type ActivityAction = "created" | "updated" | "deleted";

// Shape written by the activity_log triggers in
// supabase/migrations/001_ark_schema.sql. A *state* value is a scalar (on
// created/deleted), a *change* a [before, after] pair (on updated).
export interface ActivityDetails {
  fields?: string[];
  stage?: ProjectStage | [ProjectStage, ProjectStage];
  status?: ProjectStatus | [ProjectStatus | null, ProjectStatus | null];
  priority?: ProjectPriority | [ProjectPriority, ProjectPriority];
  product_type?: ProductType;
  archived?: [boolean, boolean];
  is_recovery?: [boolean, boolean];
  full_name?: [string | null, string | null];
  parent_type?: "project" | "contact";
  parent_id?: string;
  document_type?: ProjectDocumentType;
  // project_document only — scalar on created/deleted, a pair on a
  // "moved to Tranche N" / "moved to General" update (supabase/
  // migrations/021_tranche_documents.sql).
  tranche_id?: string | null | [string | null, string | null];
  kind?: ProjectStepKind;
  due_date?: string | null;
  done?: [boolean, boolean];
  // products / document_types
  name?: [string | null, string | null];
  active?: [boolean, boolean];
  sort_order?: number;
  // app_settings
  default_currency?: [Currency, Currency];
  stuck_after_days?: [number, number];
  show_recovery?: [boolean, boolean];
  // users (active is reused from products/document_types above, with
  // entity_type === "user" picking the "deactivated"/"reactivated"
  // wording instead of "hidden"/"shown" — see lib/activity.ts)
  role?: [UserRole | null, UserRole | null];
  event?: "password_reset";
  // project_product (scalar on created/deleted) and projects'
  // final_product (a pair on updated, like stage/status above)
  product?: string;
  final_product?: [string | null, string | null];
  // note (parent_type/parent_id above double as its project-or-contact
  // link; is_reminder is a scalar on created, reminder_done a pair on
  // updated, matching the done convention above)
  is_reminder?: boolean;
  reminder_done?: [boolean, boolean];
  // receiver_intermediary (scalar on created/deleted) and
  // project_intermediary (scalar on created/deleted, a pair on
  // updated — the only UPDATE either table gets is a reorder)
  person_id?: string;
  position?: number | [number, number];
  // project_tranche (supabase/migrations/023_tranche_confirmed.sql,
  // 025_payouts.sql) — always a pair; the trigger fires on a
  // confirmed_on and/or paid_out_on change (each gets its own row when
  // both change in the same update).
  tranche_number?: number;
  confirmed_on?: [string | null, string | null];
  paid_out_on?: [string | null, string | null];
}

export interface ActivityLog {
  id: string;
  created_at: string;
  entity_type: ActivityEntityType;
  entity_id: string;
  action: ActivityAction;
  summary: string | null;
  details: ActivityDetails | null;
  actor_id: string | null;
  actor_label: string | null;
}

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

export type ProjectStatus =
  | "open"
  | "with_receiver"
  | "with_sender"
  | "waiting"
  | "in_process"
  | "completed"
  | "lost";

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
}

export interface Contact {
  id: string;
  created_at: string;
  full_name: string;
  notes: string | null;
}

// One row per product a contact handles. Unique (contact_id,
// product_type) — a contact has at most one ratio on record per
// product.
export interface ContactProduct {
  id: string;
  contact_id: string;
  product_type: ProductType;
  ratio: string | null;
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
export interface ProjectTranche {
  id: string;
  project_id: string;
  tranche_number: number;
  amount: number | null;
  sent_on: string | null;
  notes: string | null;
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

export interface ProjectDocument {
  id: string;
  project_id: string;
  document_type: ProjectDocumentType;
  file_path: string;
  file_name: string;
  file_hash: string | null;
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
  file_path: string;
  file_name: string;
  file_hash: string | null;
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
  | "note";

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
  full_name?: [string | null, string | null];
  parent_type?: "project" | "contact";
  parent_id?: string;
  document_type?: ProjectDocumentType;
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

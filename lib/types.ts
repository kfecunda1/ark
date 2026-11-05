export type ProductType =
  | "SBLC"
  | "MX103"
  | "MT103"
  | "IP-IP"
  | "API"
  | "API Cash"
  | "T2T"
  | "S2S"
  | "VISA"
  | "GPI"
  | "KTK";

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

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
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
  product_type: ProductType;
  stage: ProjectStage;
  // Only meaningful once stage === "status" — the DB enforces "required
  // when stage = status" but not the reverse, so this can still be set
  // from an earlier visit to the Status stage.
  status: ProjectStatus | null;
  client_contact_id: string | null;
  assigned_contact_id: string | null;
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
  // The contact the ratio auto-fill (components/projects/project-form.
  // tsx) reads from — independent of client/assigned above.
  matched_contact_id: string | null;
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

export type ProjectDocumentType =
  | "CIS"
  | "POF"
  | "DOA"
  | "PGL"
  | "JSON"
  | "Proof of Fulfillment"
  | "Supporting Documents"
  | "Additional Documents";

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
// replacing the old per-project Notes section.
export type ProjectStepKind = "step_taken" | "next_step" | "note";

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

// Projects no longer link to notes (supabase/migrations/004_timeline.sql
// dropped notes.project_id) — a note links to a contact or nothing.
export interface Note {
  id: string;
  created_at: string;
  created_by: string | null;
  title: string | null;
  content: string;
  is_reminder: boolean;
  due_date: string | null;
  reminded_at: string | null;
  contact_id: string | null;
}

export type ActivityEntityType =
  | "project"
  | "contact"
  | "project_document"
  | "contact_product"
  | "contact_document"
  | "project_step"
  | "backup"
  | "password_change";

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

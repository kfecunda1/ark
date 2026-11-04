export type ProjectPriority = "low" | "medium" | "high" | "urgent";

export type ProjectStage = "new" | "in_progress" | "closed_won" | "closed_lost";

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
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export interface ContactCapability {
  id: string;
  contact_id: string;
  tag: string;
  created_at: string;
}

// Phase 1 note: this still reads/writes the `leads` table and its
// `lead_*` columns/buckets (lead_id, lead-documents, …) — renaming those
// needs a migration, which Phase 2 does when it replaces this legacy
// schema with a clean ARK one (see AGENTS.md).
export interface Project {
  id: string;
  created_at: string;
  updated_at: string;
  product_type: string;
  procedure_type: string;
  priority: ProjectPriority;
  stage: ProjectStage;
  stage_updated_at: string;
  primary_contact_id: string | null;
  counterparty_contact_id: string | null;
  deal_value: number | null;
  currency: string | null;
  source: string | null;
  notes: string | null;
  follow_up_date: string | null;
  assigned_to: string | null;
  archived: boolean;
}

export type ProjectDocumentType = "CIS" | "MOU" | "SPA" | "IMFPA" | "Other";

export interface ProjectDocument {
  id: string;
  lead_id: string;
  document_type: ProjectDocumentType;
  file_path: string;
  file_name: string;
  file_hash: string | null;
  created_at: string;
}

export interface Note {
  id: string;
  created_at: string;
  created_by: string | null;
  title: string | null;
  content: string;
  is_reminder: boolean;
  due_date: string | null;
  reminded_at: string | null;
  lead_id: string | null;
  contact_id: string | null;
}

export type ActivityEntityType = "lead" | "contact" | "lead_document";

export type ActivityAction = "created" | "updated" | "deleted";

// Shape written by the activity_log triggers in migration 019. A *state*
// value is a scalar (on created/deleted), a *change* a [before, after]
// pair (on updated) — see the migration's design notes.
export interface ActivityDetails {
  fields?: string[];
  stage?: ProjectStage | [ProjectStage, ProjectStage];
  priority?: ProjectPriority | [ProjectPriority, ProjectPriority];
  archived?: [boolean, boolean];
  full_name?: [string | null, string | null];
  parent_type?: "lead";
  parent_id?: string;
  document_type?: ProjectDocumentType;
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
  notified_at: string | null;
}

export type BusinessLine = "crypto" | "gold" | "pgm" | "oil_products" | "banking";

export type LeadPriority = "low" | "medium" | "high" | "urgent";

export type LeadStage = "new" | "in_progress" | "closed_won" | "closed_lost";

export type ProcedureSource = "whatsapp" | "telegram" | "document" | "link";

export type ProcedureStatus = "unmatched" | "matched" | "archived";

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

export interface Lead {
  id: string;
  created_at: string;
  updated_at: string;
  business_line: BusinessLine;
  product_type: string;
  procedure_type: string;
  priority: LeadPriority;
  stage: LeadStage;
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

export interface Procedure {
  id: string;
  created_at: string;
  updated_at: string;
  title: string | null;
  source: ProcedureSource | null;
  raw_content: string;
  area: BusinessLine | null;
  status: ProcedureStatus;
  contact_id: string | null;
  telegram_chat_id: number | null;
  intended_as_lead: boolean | null;
  possible_duplicate: boolean;
}

export interface ProcedureLeadMatch {
  id: string;
  procedure_id: string;
  lead_id: string;
  created_at: string;
}

export type LeadDocumentType = "CIS" | "MOU" | "SPA" | "IMFPA" | "Other";

export interface LeadDocument {
  id: string;
  lead_id: string;
  document_type: LeadDocumentType;
  file_path: string;
  file_name: string;
  file_hash: string | null;
  created_at: string;
}

export interface ProcedureWallet {
  id: string;
  procedure_id: string;
  wallet_address: string;
  label: string | null;
  created_at: string;
}

export interface LeadWallet {
  id: string;
  lead_id: string;
  wallet_address: string;
  label: string | null;
  created_at: string;
}

export interface ProcedureDocument {
  id: string;
  procedure_id: string;
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
  procedure_id: string | null;
  contact_id: string | null;
}

export type ActivityEntityType = "lead" | "procedure" | "contact" | "lead_document" | "procedure_document";

export type ActivityAction = "created" | "updated" | "deleted";

// Shape written by the activity_log triggers in migration 019. A *state*
// value is a scalar (on created/deleted), a *change* a [before, after]
// pair (on updated) — see the migration's design notes.
export interface ActivityDetails {
  fields?: string[];
  stage?: LeadStage | [LeadStage, LeadStage];
  status?: ProcedureStatus | [ProcedureStatus, ProcedureStatus];
  priority?: LeadPriority | [LeadPriority, LeadPriority];
  archived?: [boolean, boolean];
  full_name?: [string | null, string | null];
  business_line?: BusinessLine;
  source?: ProcedureSource | null;
  parent_type?: "lead" | "procedure";
  parent_id?: string;
  document_type?: LeadDocumentType;
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

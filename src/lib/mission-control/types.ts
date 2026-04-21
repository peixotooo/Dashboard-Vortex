// Mission Control domain types. Mirror the shapes stored in mc_* tables.

export type DemandStatus =
  | "new"
  | "triaged"
  | "assigned"
  | "waiting_person"
  | "in_progress"
  | "waiting_external"
  | "blocked"
  | "ready_for_review"
  | "done"
  | "canceled";

export type Priority = "critical" | "high" | "medium" | "low";

export type Health =
  | "on_track"
  | "attention"
  | "delayed"
  | "blocked"
  | "at_risk";

export type Area =
  | "acquisition"
  | "conversion"
  | "retention"
  | "crm"
  | "creative"
  | "site"
  | "finance"
  | "ops"
  | "reporting"
  | "analytics";

export type Channel =
  | "meta_ads"
  | "google_ads"
  | "email"
  | "whatsapp"
  | "influencer"
  | "organic"
  | "site"
  | "crm"
  | "marketplace"
  | "mixed";

export type ReplyStatus =
  | "pending"
  | "replied"
  | "late_reply"
  | "no_reply"
  | "clarified"
  | "blocked";

export type ReplyQuality = "complete" | "incomplete" | "vague" | "inconsistent";

export type MessageType =
  | "ask"
  | "charge"
  | "reminder"
  | "unblock"
  | "escalation"
  | "confirmation";

export type ExperimentStatus =
  | "backlog"
  | "approved"
  | "running"
  | "analyzing"
  | "won"
  | "lost"
  | "inconclusive"
  | "paused";

export interface Demand {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  area: Area;
  channel: Channel | null;
  company: string | null;
  source: string | null;
  requester: string | null;
  owner: string | null;
  secondary_owner: string | null;
  assigned_by: string | null;
  response_required_from: string | null;
  status: DemandStatus;
  priority: Priority;
  health: Health;
  urgency: string | null;
  created_at_utc: string;
  created_at_local: string | null;
  first_seen_at_utc: string | null;
  assigned_at_utc: string | null;
  started_at_utc: string | null;
  last_updated_at_utc: string;
  next_follow_up_at_utc: string | null;
  due_at_utc: string | null;
  blocked_at_utc: string | null;
  resolved_at_utc: string | null;
  closed_at_utc: string | null;
  objective: string | null;
  expected_outcome: string | null;
  current_situation: string | null;
  next_action: string | null;
  next_action_owner: string | null;
  next_action_due_at_utc: string | null;
  blocker: string | null;
  blocker_owner: string | null;
  unblock_action: string | null;
  requires_reply: boolean;
  reply_sla_hours: number;
  follow_up_rule: string | null;
  escalation_rule: string | null;
  waiting_for_person: string | null;
  waiting_since_at_utc: string | null;
  waiting_last_reply_at_utc: string | null;
  no_reply_since_hours: number | null;
  acquisition_impact: string | null;
  conversion_impact: string | null;
  retention_impact: string | null;
  revenue_impact: string | null;
  risk_level: string | null;
  related_campaigns: string[];
  related_channels: string[];
  related_tasks: string[];
  related_decision_ids: string[];
  related_learning_ids: string[];
  related_report_ids: string[];
  evidence_links: string[];
  created_by: string | null;
  updated_at: string;
}

export interface FollowUp {
  id: string;
  workspace_id: string;
  demand_id: string | null;
  target_person: string;
  target_role: string | null;
  message_type: MessageType;
  message_text: string;
  sent_at_utc: string;
  due_reply_at_utc: string | null;
  replied_at_utc: string | null;
  reply_status: ReplyStatus;
  reply_quality: ReplyQuality | null;
  follow_up_number: number;
  escalate_if_no_reply: boolean;
  escalation_target: string | null;
  outcome: string | null;
  created_at: string;
  updated_at: string;
}

export interface Experiment {
  id: string;
  workspace_id: string;
  title: string;
  hypothesis: string;
  area: Area;
  channel: Channel | null;
  owner: string | null;
  status: ExperimentStatus;
  priority: Priority;
  start_date_utc: string | null;
  end_date_utc: string | null;
  baseline_metric: string | null;
  target_metric: string | null;
  current_metric: string | null;
  expected_impact: string | null;
  actual_impact: string | null;
  confidence: string | null;
  decision: string | null;
  next_step: string | null;
  linked_demand_ids: string[];
  linked_campaigns: string[];
  learning_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface Decision {
  id: string;
  workspace_id: string;
  title: string;
  decision: string;
  why: string;
  decision_date_utc: string;
  decided_by: string | null;
  area: string | null;
  impact_level: "high" | "medium" | "low" | null;
  related_demand_ids: string[];
  related_experiment_ids: string[];
  expiry_review_date_utc: string | null;
  still_valid: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Learning {
  id: string;
  workspace_id: string;
  title: string;
  learning: string;
  type: string | null;
  source: string | null;
  date_utc: string;
  area: string | null;
  channel: string | null;
  confidence: string | null;
  reusable: boolean;
  related_campaigns: string[];
  related_experiments: string[];
  related_decision_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface ExecutiveReport {
  id: string;
  workspace_id: string;
  period_type: string | null;
  period_label: string | null;
  generated_at_utc: string;
  audience: string | null;
  summary: string;
  what_improved: string | null;
  what_worsened: string | null;
  blockers: string | null;
  next_actions: string | null;
  decisions_needed: string | null;
  linked_demand_ids: string[];
  linked_metrics: Record<string, unknown>;
  sent: boolean;
  sent_at_utc: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityLogEntry {
  id: string;
  workspace_id: string;
  demand_id: string | null;
  entity_type: string;
  entity_id: string | null;
  actor: string | null;
  actor_type: "human" | "agent" | "system" | null;
  event_type: string;
  timestamp_utc: string;
  summary: string | null;
  before_value: unknown;
  after_value: unknown;
  notes: string | null;
}

export const DEMAND_STATUSES: DemandStatus[] = [
  "new",
  "triaged",
  "assigned",
  "waiting_person",
  "in_progress",
  "waiting_external",
  "blocked",
  "ready_for_review",
  "done",
  "canceled",
];

export const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];
export const HEALTHS: Health[] = [
  "on_track",
  "attention",
  "delayed",
  "blocked",
  "at_risk",
];
export const AREAS: Area[] = [
  "acquisition",
  "conversion",
  "retention",
  "crm",
  "creative",
  "site",
  "finance",
  "ops",
  "reporting",
  "analytics",
];
export const CHANNELS: Channel[] = [
  "meta_ads",
  "google_ads",
  "email",
  "whatsapp",
  "influencer",
  "organic",
  "site",
  "crm",
  "marketplace",
  "mixed",
];
export const REPLY_STATUSES: ReplyStatus[] = [
  "pending",
  "replied",
  "late_reply",
  "no_reply",
  "clarified",
  "blocked",
];
export const MESSAGE_TYPES: MessageType[] = [
  "ask",
  "charge",
  "reminder",
  "unblock",
  "escalation",
  "confirmation",
];
export const EXPERIMENT_STATUSES: ExperimentStatus[] = [
  "backlog",
  "approved",
  "running",
  "analyzing",
  "won",
  "lost",
  "inconclusive",
  "paused",
];

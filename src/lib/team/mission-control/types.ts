// Mission Control domain types. Mirror the shapes stored in mc_* tables.

export type DemandStatus =
  | "new"
  | "triaged"
  | "assigned"
  | "waiting_person"
  | "waiting_founder"
  | "waiting_data"
  | "waiting_content"
  | "waiting_external"
  | "in_progress"
  | "blocked"
  | "ready_for_review"
  | "done"
  | "canceled"
  | "archived";

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

export type DeliverableType =
  | "report"
  | "action"
  | "analysis"
  | "test"
  | "bug"
  | "follow_up"
  | "decision"
  | "content"
  | "other";

export type TeamLabel =
  | "marketing"
  | "ecommerce"
  | "crm"
  | "ops"
  | "finance"
  | "product"
  | "data"
  | "content"
  | "other";

export type CommChannel =
  | "whatsapp"
  | "telegram"
  | "internal"
  | "email"
  | "slack"
  | "sms";

export type TestType =
  | "ab"
  | "multivariate"
  | "before_after"
  | "holdout"
  | "cohort"
  | "lift"
  | "qualitative"
  | "other";

export type NotificationStatus =
  | "pending"
  | "sent"
  | "failed"
  | "skipped"
  | "canceled";

// Per-priority SLA (hours). Override on a demand via reply_sla_hours.
export const DEFAULT_SLA_BY_PRIORITY: Record<Priority, number> = {
  critical: 1,
  high: 3,
  medium: 6,
  low: 24,
};

export interface Person {
  id: string;
  workspace_id: string;
  name: string;
  role: string | null;
  team: string | null;
  channel: CommChannel | null;
  phone_or_chat_id: string | null;
  email: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationQueueEntry {
  id: string;
  workspace_id: string;
  entity_type: string;
  entity_id: string | null;
  event: string;
  target_person_id: string | null;
  target_person_name: string | null;
  channel: CommChannel | null;
  payload: Record<string, unknown>;
  scheduled_at_utc: string;
  sent_at_utc: string | null;
  status: NotificationStatus;
  error: string | null;
  attempts: number;
  created_at: string;
}

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
  requested_by_role: string | null;
  team: TeamLabel | null;
  deliverable_type: DeliverableType | null;
  owner: string | null;
  owner_person_id: string | null;
  secondary_owner: string | null;
  assigned_by: string | null;
  response_required_from: string | null;
  parent_demand_id: string | null;
  depends_on_ids: string[];
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
  success_metric: string | null;
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
  waiting_for_person_id: string | null;
  waiting_since_at_utc: string | null;
  waiting_last_reply_at_utc: string | null;
  no_reply_since_hours: number | null;
  acquisition_impact: string | null;
  conversion_impact: string | null;
  retention_impact: string | null;
  revenue_impact: string | null;
  risk_level: string | null;
  completion_notes: string | null;
  failure_reason: string | null;
  metric_snapshot_json: Record<string, unknown> | null;
  metric_snapshot_captured_at_utc: string | null;
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
  target_person_id: string | null;
  target_role: string | null;
  channel: CommChannel | null;
  sent_by: string | null;
  message_type: MessageType;
  message_text: string;
  sent_at_utc: string;
  due_reply_at_utc: string | null;
  replied_at_utc: string | null;
  reply_status: ReplyStatus;
  reply_quality: ReplyQuality | null;
  response_text: string | null;
  response_summary: string | null;
  is_sla_breached: boolean;
  breach_hours: number | null;
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
  test_type: TestType | null;
  sample_size: number | null;
  stop_rule: string | null;
  win_rule: string | null;
  loss_rule: string | null;
  final_decision_reason: string | null;
  decision: string | null;
  next_step: string | null;
  linked_demand_ids: string[];
  linked_campaigns: string[];
  learning_summary: string | null;
  metric_snapshot_json: Record<string, unknown> | null;
  metric_snapshot_captured_at_utc: string | null;
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
  "waiting_founder",
  "waiting_data",
  "waiting_content",
  "waiting_external",
  "in_progress",
  "blocked",
  "ready_for_review",
  "done",
  "canceled",
  "archived",
];

export const WAITING_STATUSES: DemandStatus[] = [
  "waiting_person",
  "waiting_founder",
  "waiting_data",
  "waiting_content",
  "waiting_external",
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
export const DELIVERABLE_TYPES: DeliverableType[] = [
  "report",
  "action",
  "analysis",
  "test",
  "bug",
  "follow_up",
  "decision",
  "content",
  "other",
];
export const TEAM_LABELS: TeamLabel[] = [
  "marketing",
  "ecommerce",
  "crm",
  "ops",
  "finance",
  "product",
  "data",
  "content",
  "other",
];
export const COMM_CHANNELS: CommChannel[] = [
  "whatsapp",
  "telegram",
  "internal",
  "email",
  "slack",
  "sms",
];
export const TEST_TYPES: TestType[] = [
  "ab",
  "multivariate",
  "before_after",
  "holdout",
  "cohort",
  "lift",
  "qualitative",
  "other",
];

// Checks a Demand can be closed — spec #10
export function validateCompletion(d: Partial<Demand>): string[] {
  const missing: string[] = [];
  if (!d.completion_notes?.trim()) missing.push("completion_notes");
  if (
    !d.expected_outcome?.trim() &&
    !d.current_situation?.trim() &&
    !d.completion_notes?.trim()
  )
    missing.push("outcome");
  const hasImpact =
    (d.acquisition_impact || "").trim() ||
    (d.conversion_impact || "").trim() ||
    (d.retention_impact || "").trim() ||
    (d.revenue_impact || "").trim();
  if (!hasImpact) missing.push("impact");
  if (!d.next_action?.trim()) missing.push("next_step");
  const hasEvidence =
    (d.evidence_links && d.evidence_links.length > 0) || d.success_metric?.trim();
  if (!hasEvidence) missing.push("evidence_or_metric");
  return missing;
}

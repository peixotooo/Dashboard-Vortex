import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Demand,
  FollowUp,
  Experiment,
  Decision,
  Learning,
  ExecutiveReport,
  ActivityLogEntry,
  DemandStatus,
  Person,
  NotificationQueueEntry,
  CommChannel,
  Priority,
} from "./types";
import {
  DEFAULT_SLA_BY_PRIORITY,
  WAITING_STATUSES,
  validateCompletion,
} from "./types";

// Whitelist of writable columns per table. Keeps stray UI fields (like `id` from
// a detail page, or transient client-only flags) from reaching PostgREST and
// triggering "column not found in schema cache" on every insert/update.
const DEMAND_WRITABLE = new Set<string>([
  "workspace_id", "title", "description", "area", "channel", "company",
  "source", "requester", "requested_by_role", "owner", "owner_person_id",
  "secondary_owner", "assigned_by", "response_required_from",
  "team", "deliverable_type", "parent_demand_id", "depends_on_ids",
  "status", "priority", "health", "urgency",
  "created_at_utc", "created_at_local", "first_seen_at_utc", "assigned_at_utc",
  "started_at_utc", "last_updated_at_utc", "next_follow_up_at_utc", "due_at_utc",
  "blocked_at_utc", "resolved_at_utc", "closed_at_utc",
  "objective", "expected_outcome", "current_situation", "success_metric",
  "next_action", "next_action_owner", "next_action_due_at_utc",
  "blocker", "blocker_owner", "unblock_action",
  "requires_reply", "reply_sla_hours", "follow_up_rule", "escalation_rule",
  "waiting_for_person", "waiting_for_person_id", "waiting_since_at_utc",
  "waiting_last_reply_at_utc", "no_reply_since_hours",
  "acquisition_impact", "conversion_impact", "retention_impact",
  "revenue_impact", "risk_level",
  "completion_notes", "failure_reason",
  "metric_snapshot_json", "metric_snapshot_captured_at_utc",
  "related_campaigns", "related_channels", "related_tasks",
  "related_decision_ids", "related_learning_ids", "related_report_ids",
  "evidence_links",
  "created_by", "updated_at",
]);

const FOLLOW_UP_WRITABLE = new Set<string>([
  "workspace_id", "demand_id", "target_person", "target_person_id", "target_role",
  "channel", "sent_by", "message_type", "message_text",
  "sent_at_utc", "due_reply_at_utc", "replied_at_utc",
  "reply_status", "reply_quality", "response_text", "response_summary",
  "is_sla_breached", "breach_hours",
  "follow_up_number", "escalate_if_no_reply", "escalation_target", "outcome",
  "updated_at",
]);

const EXPERIMENT_WRITABLE = new Set<string>([
  "workspace_id", "title", "hypothesis", "area", "channel", "owner",
  "status", "priority", "start_date_utc", "end_date_utc",
  "baseline_metric", "target_metric", "current_metric",
  "expected_impact", "actual_impact", "confidence",
  "test_type", "sample_size", "stop_rule", "win_rule", "loss_rule",
  "final_decision_reason", "decision", "next_step",
  "linked_demand_ids", "linked_campaigns", "learning_summary",
  "metric_snapshot_json", "metric_snapshot_captured_at_utc",
  "updated_at",
]);

function pick<T extends Record<string, unknown>>(
  obj: T,
  allowed: Set<string>
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    if (allowed.has(k)) out[k] = obj[k];
  }
  return out as Partial<T>;
}

// Mission Control DB helpers. Every write goes through here so the activity
// log stays in lockstep with state changes and SLA fields stay consistent.

// ---------------------------------------------------------------------------
// ACTIVITY LOG
// ---------------------------------------------------------------------------
async function logActivity(
  supabase: SupabaseClient,
  workspaceId: string,
  entry: {
    demandId?: string | null;
    entityType?: string;
    entityId?: string | null;
    actor?: string | null;
    actorType?: "human" | "agent" | "system";
    eventType: string;
    summary?: string | null;
    beforeValue?: unknown;
    afterValue?: unknown;
    notes?: string | null;
  }
) {
  await supabase.from("mc_activity_log").insert({
    workspace_id: workspaceId,
    demand_id: entry.demandId ?? null,
    entity_type: entry.entityType ?? "demand",
    entity_id: entry.entityId ?? entry.demandId ?? null,
    actor: entry.actor ?? null,
    actor_type: entry.actorType ?? "human",
    event_type: entry.eventType,
    summary: entry.summary ?? null,
    before_value: entry.beforeValue ?? null,
    after_value: entry.afterValue ?? null,
    notes: entry.notes ?? null,
  });
}

export async function listActivity(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: { demandId?: string; limit?: number } = {}
): Promise<ActivityLogEntry[]> {
  let query = supabase
    .from("mc_activity_log")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("timestamp_utc", { ascending: false })
    .limit(filters.limit ?? 200);

  if (filters.demandId) query = query.eq("demand_id", filters.demandId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ActivityLogEntry[];
}

// ---------------------------------------------------------------------------
// DEMANDS
// ---------------------------------------------------------------------------

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

// Resolve the effective SLA in hours for a demand. Explicit override on the
// demand wins; otherwise fall back to the per-priority default.
export function effectiveSlaHours(d: Partial<Demand>): number {
  if (typeof d.reply_sla_hours === "number" && d.reply_sla_hours > 0) {
    return d.reply_sla_hours;
  }
  const p = (d.priority as Priority) ?? "medium";
  return DEFAULT_SLA_BY_PRIORITY[p] ?? 6;
}

function applyDerivedFields(
  input: Partial<Demand>,
  existing?: Partial<Demand>
): Partial<Demand> {
  const next: Partial<Demand> = { ...input };
  const status = (next.status ?? existing?.status) as DemandStatus | undefined;
  const merged: Partial<Demand> = { ...existing, ...next };
  const sla = effectiveSlaHours(merged);

  // any waiting_* status => schedule follow-up at now + SLA, stamp waiting_since
  if (status && (WAITING_STATUSES as DemandStatus[]).includes(status)) {
    if (!next.waiting_since_at_utc && !existing?.waiting_since_at_utc) {
      next.waiting_since_at_utc = new Date().toISOString();
    }
    if (!next.next_follow_up_at_utc && !existing?.next_follow_up_at_utc) {
      next.next_follow_up_at_utc = hoursFromNow(sla);
    }
  } else if (status) {
    // left every waiting state — clear the target so badges/filters reset
    if (!("waiting_for_person" in next)) next.waiting_for_person = null;
    if (!("waiting_for_person_id" in next)) next.waiting_for_person_id = null;
  }

  if (status === "blocked" && !next.blocked_at_utc && !existing?.blocked_at_utc) {
    next.blocked_at_utc = new Date().toISOString();
  }

  if (status === "done") {
    if (!next.resolved_at_utc) next.resolved_at_utc = new Date().toISOString();
    if (!next.closed_at_utc) next.closed_at_utc = new Date().toISOString();
  }

  if (status === "in_progress" && !next.started_at_utc && !existing?.started_at_utc) {
    next.started_at_utc = new Date().toISOString();
  }

  if (status === "assigned" && !next.assigned_at_utc && !existing?.assigned_at_utc) {
    next.assigned_at_utc = new Date().toISOString();
  }

  next.last_updated_at_utc = new Date().toISOString();
  return next;
}

export async function listDemands(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: {
    status?: string;
    area?: string;
    owner?: string;
    waitingForPerson?: string;
    waitingForAny?: boolean;
    blocked?: boolean;
    priority?: string;
    search?: string;
  } = {}
): Promise<Demand[]> {
  let query = supabase
    .from("mc_demands")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("last_updated_at_utc", { ascending: false });

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.area) query = query.eq("area", filters.area);
  if (filters.owner) query = query.eq("owner", filters.owner);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.waitingForPerson)
    query = query.eq("waiting_for_person", filters.waitingForPerson);
  if (filters.waitingForAny) query = query.not("waiting_for_person", "is", null);
  if (filters.blocked) query = query.eq("status", "blocked");
  if (filters.search) query = query.ilike("title", `%${filters.search}%`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Demand[];
}

export async function getDemand(
  supabase: SupabaseClient,
  id: string
): Promise<Demand | null> {
  const { data, error } = await supabase
    .from("mc_demands")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Demand) ?? null;
}

export async function createDemand(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Partial<Demand>,
  actor?: string
): Promise<Demand> {
  const rawPayload = applyDerivedFields({
    ...input,
    workspace_id: workspaceId,
    first_seen_at_utc: input.first_seen_at_utc ?? new Date().toISOString(),
    created_at_local:
      input.created_at_local ??
      new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
  const payload = pick(rawPayload as Record<string, unknown>, DEMAND_WRITABLE);

  const { data, error } = await supabase
    .from("mc_demands")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  const created = data as Demand;
  await logActivity(supabase, workspaceId, {
    demandId: created.id,
    actor,
    eventType: "demand.created",
    summary: `Demanda criada: ${created.title}`,
    afterValue: { status: created.status, priority: created.priority },
  });
  return created;
}

export class CompletionRequiredError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`Demanda nao pode ser fechada sem: ${missing.join(", ")}`);
    this.missing = missing;
    this.name = "CompletionRequiredError";
  }
}

export async function updateDemand(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  input: Partial<Demand>,
  actor?: string,
  options: { force?: boolean } = {}
): Promise<Demand> {
  const before = await getDemand(supabase, id);
  if (!before) throw new Error("Demand not found");

  // Hard guard — demand done requires completion_notes + outcome + impact +
  // next_step + evidence/metric. Use options.force=true to bypass (archive).
  const mergedForCheck: Partial<Demand> = { ...before, ...input };
  if (
    !options.force &&
    mergedForCheck.status === "done" &&
    before.status !== "done"
  ) {
    const missing = validateCompletion(mergedForCheck);
    if (missing.length > 0) throw new CompletionRequiredError(missing);
  }

  const rawPayload = applyDerivedFields(input, before);
  const payload = pick(rawPayload as Record<string, unknown>, DEMAND_WRITABLE);
  const { data, error } = await supabase
    .from("mc_demands")
    .update(payload)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const after = data as Demand;

  if (before.status !== after.status) {
    await logActivity(supabase, workspaceId, {
      demandId: id,
      actor,
      eventType: "demand.status_changed",
      summary: `Status ${before.status} → ${after.status}`,
      beforeValue: { status: before.status },
      afterValue: { status: after.status },
    });
  } else {
    await logActivity(supabase, workspaceId, {
      demandId: id,
      actor,
      eventType: "demand.updated",
      summary: "Demanda atualizada",
      afterValue: input,
    });
  }

  // Concluded demands were guarded above, but we still log the summary for auditability.
  if (after.status === "done" && before.status !== "done") {
    await logActivity(supabase, workspaceId, {
      demandId: id,
      actor: actor ?? "system",
      actorType: "human",
      eventType: "demand.completed",
      summary: after.completion_notes
        ? after.completion_notes.slice(0, 200)
        : "Demanda concluida",
      afterValue: {
        outcome: after.expected_outcome,
        impact:
          after.revenue_impact ||
          after.acquisition_impact ||
          after.conversion_impact ||
          after.retention_impact,
        success_metric: after.success_metric,
        evidence: after.evidence_links,
      },
    });
  }

  return after;
}

export async function deleteDemand(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  actor?: string
): Promise<void> {
  await logActivity(supabase, workspaceId, {
    demandId: id,
    actor,
    eventType: "demand.deleted",
    summary: "Demanda removida",
  });
  const { error } = await supabase
    .from("mc_demands")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

// Mark expired follow-ups as no_reply + persist is_sla_breached + breach_hours.
// Safe to run on every list call.
export async function sweepOverdueFollowUps(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("mc_follow_ups")
    .select("id, due_reply_at_utc")
    .eq("workspace_id", workspaceId)
    .eq("reply_status", "pending")
    .lt("due_reply_at_utc", nowIso)
    .is("replied_at_utc", null);
  if (error || !data?.length) return 0;

  await Promise.all(
    data.map((row) => {
      const breach =
        row.due_reply_at_utc
          ? Math.max(
              0,
              (Date.now() - new Date(row.due_reply_at_utc).getTime()) / 36e5
            )
          : 0;
      return supabase
        .from("mc_follow_ups")
        .update({
          reply_status: "no_reply",
          is_sla_breached: true,
          breach_hours: Math.round(breach * 10) / 10,
          updated_at: nowIso,
        })
        .eq("id", row.id);
    })
  );

  // enqueue SLA-breach notifications (best-effort — ignore failures)
  await Promise.all(
    data.map((row) =>
      enqueueNotification(supabase, workspaceId, {
        entity_type: "follow_up",
        entity_id: row.id,
        event: "sla_breach",
        payload: { due_reply_at_utc: row.due_reply_at_utc },
      }).catch(() => null)
    )
  );

  return data.length;
}

// Derived helper — hours overdue for a demand waiting on a person
export function overdueHours(iso: string | null): number {
  if (!iso) return 0;
  const diff = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.round(diff / 36e5));
}

// ---------------------------------------------------------------------------
// FOLLOW-UPS
// ---------------------------------------------------------------------------
export async function listFollowUps(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: { demandId?: string; replyStatus?: string } = {}
): Promise<FollowUp[]> {
  let query = supabase
    .from("mc_follow_ups")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("sent_at_utc", { ascending: false });
  if (filters.demandId) query = query.eq("demand_id", filters.demandId);
  if (filters.replyStatus) query = query.eq("reply_status", filters.replyStatus);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as FollowUp[];
}

export async function createFollowUp(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Partial<FollowUp> & { target_person: string },
  actor?: string
): Promise<FollowUp> {
  const sentAt = input.sent_at_utc ?? new Date().toISOString();
  let dueReply = input.due_reply_at_utc;

  // if pointing at a demand and no explicit due, default to sent + effective SLA
  let channelFromDemand: CommChannel | null = null;
  if (!dueReply && input.demand_id) {
    const demand = await getDemand(supabase, input.demand_id);
    if (demand) {
      const sla = effectiveSlaHours(demand);
      dueReply = new Date(
        new Date(sentAt).getTime() + sla * 3600 * 1000
      ).toISOString();
    }
  }

  // If caller didn't specify a channel but the target is a known person, use theirs
  if (!input.channel && input.target_person_id) {
    const { data: person } = await supabase
      .from("mc_people")
      .select("channel")
      .eq("id", input.target_person_id)
      .maybeSingle();
    if (person?.channel) channelFromDemand = person.channel as CommChannel;
  }

  const payload = {
    workspace_id: workspaceId,
    demand_id: input.demand_id ?? null,
    target_person: input.target_person,
    target_person_id: input.target_person_id ?? null,
    target_role: input.target_role ?? null,
    channel: input.channel ?? channelFromDemand ?? null,
    sent_by: input.sent_by ?? actor ?? null,
    message_type: input.message_type ?? "ask",
    message_text: input.message_text ?? "",
    sent_at_utc: sentAt,
    due_reply_at_utc: dueReply ?? null,
    replied_at_utc: input.replied_at_utc ?? null,
    reply_status: input.reply_status ?? "pending",
    reply_quality: input.reply_quality ?? null,
    response_text: input.response_text ?? null,
    response_summary: input.response_summary ?? null,
    follow_up_number: input.follow_up_number ?? 1,
    escalate_if_no_reply: input.escalate_if_no_reply ?? false,
    escalation_target: input.escalation_target ?? null,
    outcome: input.outcome ?? null,
  };

  const safePayload = pick(payload as Record<string, unknown>, FOLLOW_UP_WRITABLE);
  const { data, error } = await supabase
    .from("mc_follow_ups")
    .insert(safePayload)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const fu = data as FollowUp;

  // If this follow-up is targeted at a person and the demand is not yet in any
  // waiting_* status, flip to waiting_person and stamp the target (id + name).
  if (fu.demand_id) {
    const demand = await getDemand(supabase, fu.demand_id);
    const isWaiting =
      demand && (WAITING_STATUSES as DemandStatus[]).includes(demand.status);
    if (demand && !isWaiting) {
      await updateDemand(
        supabase,
        workspaceId,
        fu.demand_id,
        {
          status: "waiting_person",
          waiting_for_person: fu.target_person,
          waiting_for_person_id: fu.target_person_id,
          next_follow_up_at_utc: fu.due_reply_at_utc,
        },
        actor ?? "system"
      );
    } else if (
      demand &&
      (demand.waiting_for_person !== fu.target_person ||
        demand.waiting_for_person_id !== fu.target_person_id)
    ) {
      await supabase
        .from("mc_demands")
        .update({
          waiting_for_person: fu.target_person,
          waiting_for_person_id: fu.target_person_id,
          next_follow_up_at_utc: fu.due_reply_at_utc,
          last_updated_at_utc: new Date().toISOString(),
        })
        .eq("id", fu.demand_id)
        .eq("workspace_id", workspaceId);
    }
  }

  await logActivity(supabase, workspaceId, {
    demandId: fu.demand_id,
    entityType: "follow_up",
    entityId: fu.id,
    actor,
    eventType: "follow_up.sent",
    summary: `Follow-up ${fu.message_type} → ${fu.target_person}`,
    afterValue: { message_type: fu.message_type, channel: fu.channel },
  });

  // Enqueue the outbound notification — the actual sender is a separate worker.
  await enqueueNotification(supabase, workspaceId, {
    entity_type: "follow_up",
    entity_id: fu.id,
    event: fu.message_type,
    target_person_id: fu.target_person_id,
    target_person_name: fu.target_person,
    channel: fu.channel,
    payload: { message_text: fu.message_text, demand_id: fu.demand_id },
  }).catch(() => null);

  return fu;
}

export async function updateFollowUp(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  input: Partial<FollowUp>,
  actor?: string
): Promise<FollowUp> {
  const patch = pick(
    { ...input, updated_at: new Date().toISOString() } as Record<string, unknown>,
    FOLLOW_UP_WRITABLE
  );
  const { data, error } = await supabase
    .from("mc_follow_ups")
    .update(patch)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const fu = data as FollowUp;

  if (input.reply_status || input.replied_at_utc) {
    await logActivity(supabase, workspaceId, {
      demandId: fu.demand_id,
      entityType: "follow_up",
      entityId: fu.id,
      actor,
      eventType: "follow_up.replied",
      summary: `Resposta marcada: ${fu.reply_status}`,
      afterValue: { reply_status: fu.reply_status, quality: fu.reply_quality },
    });

    // If the target person replied, clear the waiting state on the demand.
    if (
      fu.demand_id &&
      (fu.reply_status === "replied" || fu.reply_status === "clarified")
    ) {
      const demand = await getDemand(supabase, fu.demand_id);
      if (demand && demand.waiting_for_person === fu.target_person) {
        await supabase
          .from("mc_demands")
          .update({
            waiting_last_reply_at_utc:
              fu.replied_at_utc ?? new Date().toISOString(),
            waiting_for_person: null,
            last_updated_at_utc: new Date().toISOString(),
          })
          .eq("id", fu.demand_id)
          .eq("workspace_id", workspaceId);
      }
    }
  }
  return fu;
}

// Quick charge helper — one follow-up to whoever the demand is waiting on.
export function defaultChargeText(person: string): string {
  const first = person.split(/\s+/)[0] || person;
  return `${first}, você conseguiu verificar ou ficou alguma dúvida?`;
}

export async function chargePerson(
  supabase: SupabaseClient,
  workspaceId: string,
  demandId: string,
  options: {
    targetPerson?: string;
    targetPersonId?: string | null;
    channel?: CommChannel | null;
    messageText?: string;
  } = {},
  actor?: string
): Promise<FollowUp> {
  const demand = await getDemand(supabase, demandId);
  if (!demand) throw new Error("Demand not found");

  const target =
    options.targetPerson ??
    demand.waiting_for_person ??
    demand.owner ??
    "Responsavel";
  const targetId =
    options.targetPersonId ?? demand.waiting_for_person_id ?? null;

  const prior = await listFollowUps(supabase, workspaceId, { demandId });
  const targetPrior = prior.filter(
    (f) => f.target_person.toLowerCase() === target.toLowerCase()
  );

  return createFollowUp(
    supabase,
    workspaceId,
    {
      demand_id: demandId,
      target_person: target,
      target_person_id: targetId,
      channel: options.channel ?? null,
      message_type: "charge",
      message_text: options.messageText ?? defaultChargeText(target),
      follow_up_number: targetPrior.length + 1,
      escalate_if_no_reply: targetPrior.length >= 2,
    },
    actor
  );
}

// ---------------------------------------------------------------------------
// EXPERIMENTS / DECISIONS / LEARNINGS / REPORTS — thin CRUD
// ---------------------------------------------------------------------------
export async function listExperiments(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: { status?: string; area?: string } = {}
): Promise<Experiment[]> {
  let query = supabase
    .from("mc_experiments")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.area) query = query.eq("area", filters.area);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Experiment[];
}

export async function saveExperiment(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Partial<Experiment> & { id?: string }
): Promise<Experiment> {
  if (input.id) {
    const patch = pick(
      { ...input, updated_at: new Date().toISOString() } as Record<string, unknown>,
      EXPERIMENT_WRITABLE
    );
    const { data, error } = await supabase
      .from("mc_experiments")
      .update(patch)
      .eq("id", input.id)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as Experiment;
  }
  const payload = pick(
    { ...input, workspace_id: workspaceId } as Record<string, unknown>,
    EXPERIMENT_WRITABLE
  );
  const { data, error } = await supabase
    .from("mc_experiments")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Experiment;
}

export async function deleteExperiment(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("mc_experiments")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

export async function listDecisions(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<Decision[]> {
  const { data, error } = await supabase
    .from("mc_decisions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("decision_date_utc", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Decision[];
}

export async function saveDecision(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Partial<Decision> & { id?: string }
): Promise<Decision> {
  if (input.id) {
    const { data, error } = await supabase
      .from("mc_decisions")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as Decision;
  }
  const { data, error } = await supabase
    .from("mc_decisions")
    .insert({ ...input, workspace_id: workspaceId })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Decision;
}

export async function deleteDecision(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("mc_decisions")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

export async function listLearnings(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<Learning[]> {
  const { data, error } = await supabase
    .from("mc_learnings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("date_utc", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Learning[];
}

export async function saveLearning(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Partial<Learning> & { id?: string }
): Promise<Learning> {
  if (input.id) {
    const { data, error } = await supabase
      .from("mc_learnings")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as Learning;
  }
  const { data, error } = await supabase
    .from("mc_learnings")
    .insert({ ...input, workspace_id: workspaceId })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Learning;
}

export async function deleteLearning(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("mc_learnings")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

export async function listReports(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<ExecutiveReport[]> {
  const { data, error } = await supabase
    .from("mc_executive_reports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("generated_at_utc", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ExecutiveReport[];
}

export async function saveReport(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Partial<ExecutiveReport> & { id?: string }
): Promise<ExecutiveReport> {
  if (input.id) {
    const { data, error } = await supabase
      .from("mc_executive_reports")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as ExecutiveReport;
  }
  const { data, error } = await supabase
    .from("mc_executive_reports")
    .insert({ ...input, workspace_id: workspaceId })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as ExecutiveReport;
}

export async function deleteReport(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("mc_executive_reports")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// PEOPLE
// ---------------------------------------------------------------------------
export async function listPeople(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: { activeOnly?: boolean } = {}
): Promise<Person[]> {
  let query = supabase
    .from("mc_people")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });
  if (filters.activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Person[];
}

export async function savePerson(
  supabase: SupabaseClient,
  workspaceId: string,
  input: Partial<Person> & { id?: string; name: string }
): Promise<Person> {
  if (input.id) {
    const { data, error } = await supabase
      .from("mc_people")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as Person;
  }
  const { data, error } = await supabase
    .from("mc_people")
    .insert({ ...input, workspace_id: workspaceId })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Person;
}

export async function deletePerson(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("mc_people")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// NOTIFICATIONS QUEUE (delivery is a separate worker — this only enqueues)
// ---------------------------------------------------------------------------
export async function enqueueNotification(
  supabase: SupabaseClient,
  workspaceId: string,
  entry: {
    entity_type: string;
    entity_id?: string | null;
    event: string;
    target_person_id?: string | null;
    target_person_name?: string | null;
    channel?: CommChannel | null;
    payload?: Record<string, unknown>;
    scheduled_at_utc?: string;
  }
): Promise<NotificationQueueEntry> {
  const { data, error } = await supabase
    .from("mc_notifications_queue")
    .insert({
      workspace_id: workspaceId,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id ?? null,
      event: entry.event,
      target_person_id: entry.target_person_id ?? null,
      target_person_name: entry.target_person_name ?? null,
      channel: entry.channel ?? null,
      payload: entry.payload ?? {},
      scheduled_at_utc: entry.scheduled_at_utc ?? new Date().toISOString(),
      status: "pending",
      attempts: 0,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as NotificationQueueEntry;
}

export async function listNotifications(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: { status?: string; limit?: number } = {}
): Promise<NotificationQueueEntry[]> {
  let query = supabase
    .from("mc_notifications_queue")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("scheduled_at_utc", { ascending: false })
    .limit(filters.limit ?? 200);
  if (filters.status) query = query.eq("status", filters.status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as NotificationQueueEntry[];
}

export async function markNotification(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  patch: Partial<NotificationQueueEntry>
): Promise<NotificationQueueEntry> {
  const { data, error } = await supabase
    .from("mc_notifications_queue")
    .update(patch)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as NotificationQueueEntry;
}

// ---------------------------------------------------------------------------
// DASHBOARD AGGREGATES
// ---------------------------------------------------------------------------
export async function dashboardSummary(
  supabase: SupabaseClient,
  workspaceId: string
) {
  await sweepOverdueFollowUps(supabase, workspaceId);
  const [demandsRes, followsRes, experimentsRes] = await Promise.all([
    supabase.from("mc_demands").select("*").eq("workspace_id", workspaceId),
    supabase
      .from("mc_follow_ups")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("reply_status", ["pending", "no_reply", "late_reply"]),
    supabase
      .from("mc_experiments")
      .select("id, title, status, priority, updated_at, decision")
      .eq("workspace_id", workspaceId)
      .eq("status", "analyzing"),
  ]);

  const demands = (demandsRes.data ?? []) as Demand[];
  const follows = (followsRes.data ?? []) as FollowUp[];
  const experimentsAnalyzing = (experimentsRes.data ?? []) as Array<{
    id: string;
    title: string;
    status: string;
    priority: Priority;
    updated_at: string;
    decision: string | null;
  }>;
  const now = Date.now();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

  const openStatuses: DemandStatus[] = [
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
  ];

  const open = demands.filter((d) => openStatuses.includes(d.status));

  // tally who owes a reply — one row per person being waited on
  const waitingByPerson = new Map<string, number>();
  demands
    .filter((d) => d.waiting_for_person)
    .forEach((d) => {
      const key = d.waiting_for_person as string;
      waitingByPerson.set(key, (waitingByPerson.get(key) ?? 0) + 1);
    });

  return {
    counts: {
      total: demands.length,
      open: open.length,
      waiting_person: demands.filter((d) => d.waiting_for_person).length,
      blocked: demands.filter((d) => d.status === "blocked").length,
      ready_for_review: demands.filter((d) => d.status === "ready_for_review").length,
      done_today: demands.filter(
        (d) => d.closed_at_utc && new Date(d.closed_at_utc) >= startOfDay
      ).length,
      follow_ups_pending: follows.filter((f) => f.reply_status === "pending").length,
      follow_ups_no_reply: follows.filter((f) => f.reply_status === "no_reply").length,
    },
    waitingByPerson: Array.from(waitingByPerson.entries())
      .map(([person, count]) => ({ person, count }))
      .sort((a, b) => b.count - a.count),
    overdueWaiting: demands
      .filter((d) => d.waiting_for_person && d.next_follow_up_at_utc)
      .map((d) => ({
        id: d.id,
        title: d.title,
        owner: d.owner,
        waiting_for: d.waiting_for_person as string,
        overdue_hours: Math.max(
          0,
          Math.round((now - new Date(d.next_follow_up_at_utc!).getTime()) / 36e5)
        ),
      }))
      .sort((a, b) => b.overdue_hours - a.overdue_hours),
    todays: open
      .filter(
        (d) =>
          (d.due_at_utc && new Date(d.due_at_utc) <= new Date(startOfDay.getTime() + 864e5)) ||
          (d.next_follow_up_at_utc && new Date(d.next_follow_up_at_utc) <= new Date(startOfDay.getTime() + 864e5))
      )
      .map((d) => d.id),
    weekly: open
      .filter(
        (d) =>
          (d.due_at_utc && new Date(d.due_at_utc) >= startOfWeek) ||
          (d.next_follow_up_at_utc && new Date(d.next_follow_up_at_utc) >= startOfWeek)
      )
      .map((d) => d.id),
    needsCooReview: buildCooReviewBuckets({
      demands,
      follows,
      experimentsAnalyzing,
      now,
    }),
  };
}

// "Needs COO Review" — 5 buckets the COO scans first thing in the morning.
// Kept as a pure function so it can be reused by a dedicated view.
export function buildCooReviewBuckets(input: {
  demands: Demand[];
  follows: FollowUp[];
  experimentsAnalyzing: Array<{
    id: string;
    title: string;
    priority: Priority;
    updated_at: string;
    decision: string | null;
  }>;
  now: number;
}) {
  const { demands, follows, experimentsAnalyzing, now } = input;

  const readyForReview = demands
    .filter((d) => d.status === "ready_for_review")
    .map((d) => ({
      id: d.id,
      title: d.title,
      owner: d.owner,
      priority: d.priority,
      updated_at: d.last_updated_at_utc,
    }));

  const doneIncomplete = demands
    .filter((d) => d.status === "done")
    .map((d) => ({ demand: d, missing: validateCompletion(d) }))
    .filter(({ missing }) => missing.length > 0)
    .map(({ demand: d, missing }) => ({
      id: d.id,
      title: d.title,
      priority: d.priority,
      missing,
    }));

  const blockedHigh = demands
    .filter(
      (d) =>
        d.status === "blocked" &&
        (d.priority === "critical" || d.priority === "high")
    )
    .map((d) => ({
      id: d.id,
      title: d.title,
      priority: d.priority,
      blocker: d.blocker,
      blocked_since: d.blocked_at_utc,
    }));

  const noReplyFollowUps = follows
    .filter(
      (f) =>
        f.reply_status === "no_reply" ||
        (f.is_sla_breached && f.reply_status === "pending")
    )
    .map((f) => ({
      id: f.id,
      demand_id: f.demand_id,
      target_person: f.target_person,
      breach_hours: f.breach_hours,
      follow_up_number: f.follow_up_number,
      due_reply_at_utc: f.due_reply_at_utc,
    }))
    .sort((a, b) => (b.breach_hours ?? 0) - (a.breach_hours ?? 0));

  const experimentsPendingDecision = experimentsAnalyzing
    .filter((e) => !e.decision)
    .map((e) => ({
      id: e.id,
      title: e.title,
      priority: e.priority,
      updated_at: e.updated_at,
    }));

  return {
    total:
      readyForReview.length +
      doneIncomplete.length +
      blockedHigh.length +
      noReplyFollowUps.length +
      experimentsPendingDecision.length,
    readyForReview,
    doneIncomplete,
    blockedHigh,
    noReplyFollowUps,
    experimentsPendingDecision,
    generated_at: new Date(now).toISOString(),
  };
}

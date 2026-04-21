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
} from "./types";

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

function applyDerivedFields(
  input: Partial<Demand>,
  existing?: Partial<Demand>
): Partial<Demand> {
  const next: Partial<Demand> = { ...input };
  const status = (next.status ?? existing?.status) as DemandStatus | undefined;
  const sla = next.reply_sla_hours ?? existing?.reply_sla_hours ?? 3;

  // waiting_pricila => schedule follow-up at sent + SLA, mark waiting flag
  if (status === "waiting_pricila") {
    next.is_waiting_on_pricila = true;
    if (!next.next_follow_up_at_utc && !existing?.next_follow_up_at_utc) {
      next.next_follow_up_at_utc = hoursFromNow(sla);
    }
  } else if (status) {
    next.is_waiting_on_pricila = false;
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
    waitingPricila?: boolean;
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
  if (filters.waitingPricila) query = query.eq("is_waiting_on_pricila", true);
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
  const payload = applyDerivedFields({
    ...input,
    workspace_id: workspaceId,
    first_seen_at_utc: input.first_seen_at_utc ?? new Date().toISOString(),
    created_at_local:
      input.created_at_local ??
      new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });

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

export async function updateDemand(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  input: Partial<Demand>,
  actor?: string
): Promise<Demand> {
  const before = await getDemand(supabase, id);
  if (!before) throw new Error("Demand not found");

  const payload = applyDerivedFields(input, before);
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

  // concluded demands must ship outcome + impact + learning — flag in log if missing
  if (after.status === "done") {
    const missing: string[] = [];
    if (!after.expected_outcome && !after.current_situation) missing.push("outcome");
    if (
      !after.acquisition_impact &&
      !after.conversion_impact &&
      !after.retention_impact &&
      !after.revenue_impact
    )
      missing.push("impacto");
    if (!after.related_learning_ids || after.related_learning_ids.length === 0)
      missing.push("aprendizado");
    if (missing.length > 0) {
      await logActivity(supabase, workspaceId, {
        demandId: id,
        actor: "system",
        actorType: "system",
        eventType: "demand.done_incomplete",
        summary: `Demanda concluida sem: ${missing.join(", ")}`,
        afterValue: { missing },
      });
    }
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

// Mark expired follow-ups as no_reply. Intended to be safe to run on each list.
export async function sweepOverdueFollowUps(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("mc_follow_ups")
    .update({ reply_status: "no_reply", updated_at: nowIso })
    .eq("workspace_id", workspaceId)
    .eq("reply_status", "pending")
    .lt("due_reply_at_utc", nowIso)
    .is("replied_at_utc", null)
    .select("id");
  if (error) return 0;
  return (data ?? []).length;
}

// Derived helper — hours overdue for a demand waiting on Pricila
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

  // if pointing at a demand and no explicit due, default to sent + sla
  if (!dueReply && input.demand_id) {
    const demand = await getDemand(supabase, input.demand_id);
    const sla = demand?.reply_sla_hours ?? 3;
    dueReply = new Date(new Date(sentAt).getTime() + sla * 3600 * 1000).toISOString();
  }

  const payload = {
    workspace_id: workspaceId,
    demand_id: input.demand_id ?? null,
    target_person: input.target_person,
    target_role: input.target_role ?? null,
    message_type: input.message_type ?? "ask",
    message_text: input.message_text ?? "",
    sent_at_utc: sentAt,
    due_reply_at_utc: dueReply ?? null,
    replied_at_utc: input.replied_at_utc ?? null,
    reply_status: input.reply_status ?? "pending",
    reply_quality: input.reply_quality ?? null,
    follow_up_number: input.follow_up_number ?? 1,
    escalate_if_no_reply: input.escalate_if_no_reply ?? false,
    escalation_target: input.escalation_target ?? null,
    outcome: input.outcome ?? null,
  };

  const { data, error } = await supabase
    .from("mc_follow_ups")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const fu = data as FollowUp;

  if (fu.demand_id) {
    const demand = await getDemand(supabase, fu.demand_id);
    if (demand && demand.status !== "waiting_pricila" && /pricila/i.test(fu.target_person)) {
      await updateDemand(
        supabase,
        workspaceId,
        fu.demand_id,
        { status: "waiting_pricila", next_follow_up_at_utc: fu.due_reply_at_utc },
        actor ?? "system"
      );
    }
  }

  await logActivity(supabase, workspaceId, {
    demandId: fu.demand_id,
    entityType: "follow_up",
    entityId: fu.id,
    actor,
    eventType: "follow_up.sent",
    summary: `Follow-up ${fu.message_type} → ${fu.target_person}`,
    afterValue: { message_type: fu.message_type },
  });

  return fu;
}

export async function updateFollowUp(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  input: Partial<FollowUp>,
  actor?: string
): Promise<FollowUp> {
  const { data, error } = await supabase
    .from("mc_follow_ups")
    .update({ ...input, updated_at: new Date().toISOString() })
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

    // if replied with content, clear waiting-on-pricila flag
    if (
      fu.demand_id &&
      /pricila/i.test(fu.target_person) &&
      (fu.reply_status === "replied" || fu.reply_status === "clarified")
    ) {
      await supabase
        .from("mc_demands")
        .update({
          pricila_last_reply_at_utc: fu.replied_at_utc ?? new Date().toISOString(),
          is_waiting_on_pricila: false,
          last_updated_at_utc: new Date().toISOString(),
        })
        .eq("id", fu.demand_id)
        .eq("workspace_id", workspaceId);
    }
  }
  return fu;
}

// Quick charge-Pricila — one-line shortcut used by the UI
export const DEFAULT_PRICILA_CHARGE_TEXT =
  "Pricila, você conseguiu verificar ou ficou alguma dúvida?";

export async function chargePricila(
  supabase: SupabaseClient,
  workspaceId: string,
  demandId: string,
  actor?: string
): Promise<FollowUp> {
  const prior = await listFollowUps(supabase, workspaceId, { demandId });
  const pricilaPrior = prior.filter((f) => /pricila/i.test(f.target_person));
  return createFollowUp(
    supabase,
    workspaceId,
    {
      demand_id: demandId,
      target_person: "Pricila",
      target_role: "ops",
      message_type: "charge",
      message_text: DEFAULT_PRICILA_CHARGE_TEXT,
      follow_up_number: pricilaPrior.length + 1,
      escalate_if_no_reply: pricilaPrior.length >= 2,
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
    const { data, error } = await supabase
      .from("mc_experiments")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as Experiment;
  }
  const { data, error } = await supabase
    .from("mc_experiments")
    .insert({ ...input, workspace_id: workspaceId })
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
// DASHBOARD AGGREGATES
// ---------------------------------------------------------------------------
export async function dashboardSummary(
  supabase: SupabaseClient,
  workspaceId: string
) {
  await sweepOverdueFollowUps(supabase, workspaceId);
  const [demandsRes, followsRes] = await Promise.all([
    supabase.from("mc_demands").select("*").eq("workspace_id", workspaceId),
    supabase
      .from("mc_follow_ups")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("reply_status", ["pending", "no_reply", "late_reply"]),
  ]);

  const demands = (demandsRes.data ?? []) as Demand[];
  const follows = (followsRes.data ?? []) as FollowUp[];
  const now = Date.now();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

  const openStatuses: DemandStatus[] = [
    "new",
    "triaged",
    "assigned",
    "waiting_pricila",
    "in_progress",
    "waiting_external",
    "blocked",
    "ready_for_review",
  ];

  const open = demands.filter((d) => openStatuses.includes(d.status));

  return {
    counts: {
      total: demands.length,
      open: open.length,
      waiting_pricila: demands.filter((d) => d.is_waiting_on_pricila).length,
      blocked: demands.filter((d) => d.status === "blocked").length,
      ready_for_review: demands.filter((d) => d.status === "ready_for_review").length,
      done_today: demands.filter(
        (d) => d.closed_at_utc && new Date(d.closed_at_utc) >= startOfDay
      ).length,
      follow_ups_pending: follows.filter((f) => f.reply_status === "pending").length,
      follow_ups_no_reply: follows.filter((f) => f.reply_status === "no_reply").length,
    },
    overdueWaitingPricila: demands
      .filter((d) => d.is_waiting_on_pricila && d.next_follow_up_at_utc)
      .map((d) => ({
        id: d.id,
        title: d.title,
        owner: d.owner,
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
  };
}

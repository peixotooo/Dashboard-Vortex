import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CART_RECOVERY_PILOT_MATURITY_HOURS,
  CART_RECOVERY_PILOT_MIN_SAMPLE,
  cartRecoveryExperimentKey,
  compareRecoveryGroups,
  type ExperimentGroupStats,
} from "./pilot";

type EnrollmentEvent = {
  event_key: string;
  cart_id: string;
  event_type: "pilot_control_enrolled" | "pilot_treatment_enrolled";
  metadata: Record<string, unknown> | null;
  occurred_at: string;
};

type CartOutcome = {
  id: string;
  status: string;
  cart_total: number | null;
  recovered_at: string | null;
};

type QueueHealth = {
  cart_id: string;
  step_id: string;
  channel: "whatsapp" | "email";
  status: string;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  payload: Record<string, unknown> | null;
};

type MessageHealth = {
  cart_id: string;
  step_id: string;
  channel: "whatsapp" | "email";
  status: string;
  external_id: string | null;
  sent_at: string;
};

type WhatsAppDelivery = {
  id: string;
  status: string;
  error_message: string | null;
};

type CohortRow = {
  cartId: string;
  cohort: "pilot" | "control";
  enrolledAt: string;
  reasonCode: string;
  actionCode: string;
  lifecycle: string;
  channel: string;
  cart: CartOutcome | null;
};

export async function buildPilotMonitoringPayload(input: {
  admin: SupabaseClient;
  workspaceId: string;
}) {
  const { data: rule, error: ruleError } = await input.admin
    .from("cart_recovery_rules")
    .select(
      "id,enabled,expire_after_hours,current_version,intelligence_mode,rollout_percentage,holdout_percentage,updated_at",
    )
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (ruleError) throw ruleError;

  const experimentKey = cartRecoveryExperimentKey(
    Number((rule as { current_version?: number } | null)?.current_version || 1),
  );
  const enrollmentData = await loadEnrollmentEvents(
    input.admin,
    input.workspaceId,
  );
  const enrollments = enrollmentData.filter(
    (event) => event.metadata?.experiment_key === experimentKey,
  );
  const cartIds = Array.from(
    new Set(enrollments.map((event) => event.cart_id)),
  );
  const [carts, queue, messages] = await Promise.all([
    loadByCartIds<CartOutcome>(
      input.admin,
      "abandoned_carts",
      "id,status,cart_total,recovered_at",
      input.workspaceId,
      cartIds,
    ),
    loadByCartIds<QueueHealth>(
      input.admin,
      "cart_recovery_action_queue",
      "cart_id,step_id,channel,status,attempts,last_error,sent_at,payload",
      input.workspaceId,
      cartIds,
    ),
    loadByCartIds<MessageHealth>(
      input.admin,
      "cart_recovery_messages",
      "cart_id,step_id,channel,status,external_id,sent_at",
      input.workspaceId,
      cartIds,
    ),
  ]);
  const cartById = new Map(carts.map((cart) => [cart.id, cart]));
  const pilotQueueByKey = new Map(
    queue.map((row) => [`${row.cart_id}:${row.step_id}:${row.channel}`, row]),
  );
  const pilotMessages = messages.filter((message) => {
    const queueRow = pilotQueueByKey.get(
      `${message.cart_id}:${message.step_id}:${message.channel}`,
    );
    if (
      !queueRow ||
      (queueRow.status !== "sent" && queueRow.status !== "failed")
    ) {
      return false;
    }
    const expectedExternalId = stringValue(queueRow.payload?.external_id);
    return expectedExternalId
      ? message.external_id === expectedExternalId
      : queueRow.status === "sent";
  });
  const whatsappIds = Array.from(
    new Set(
      queue
        .filter((row) => row.channel === "whatsapp")
        .map((row) => stringValue(row.payload?.external_id))
        .filter(Boolean),
    ),
  );
  const whatsappDelivery = await loadByIds<WhatsAppDelivery>(
    input.admin,
    "wa_messages",
    "id,status,error_message",
    input.workspaceId,
    whatsappIds,
  );
  const rows: CohortRow[] = enrollments.map((event) => ({
    cartId: event.cart_id,
    cohort:
      event.event_type === "pilot_treatment_enrolled" ? "pilot" : "control",
    enrolledAt: event.occurred_at,
    reasonCode: stringValue(event.metadata?.reason_code),
    actionCode: stringValue(event.metadata?.action_code),
    lifecycle: stringValue(event.metadata?.lifecycle),
    channel: stringValue(event.metadata?.channel),
    cart: cartById.get(event.cart_id) || null,
  }));
  const now = Date.now();
  const maturityCutoff = now - CART_RECOVERY_PILOT_MATURITY_HOURS * 60 * 60_000;
  const matureRows = rows.filter(
    (row) => new Date(row.enrolledAt).getTime() <= maturityCutoff,
  );
  const allGroups = groupMetrics(rows, messages);
  const matureGroups = groupMetrics(matureRows, messages);
  const comparison = compareRecoveryGroups({
    pilot: experimentStats(matureGroups.pilot),
    control: experimentStats(matureGroups.control),
  });
  const enrollmentRate = dailyEnrollmentRate(rows);
  const remainingPilot = Math.max(
    0,
    CART_RECOVERY_PILOT_MIN_SAMPLE - matureGroups.pilot.sample,
  );
  const remainingControl = Math.max(
    0,
    CART_RECOVERY_PILOT_MIN_SAMPLE - matureGroups.control.sample,
  );
  const estimatedDaysRemaining = Math.max(
    estimateDays(remainingPilot, enrollmentRate.pilot),
    estimateDays(remainingControl, enrollmentRate.control),
  );
  const queueStatus = countBy(queue, (row) => row.status);
  const queueFailures = queueStatus.failed || 0;
  const completedQueue = (queueStatus.sent || 0) + queueFailures;
  const queueFailureRate =
    completedQueue > 0 ? queueFailures / completedQueue : 0;
  const messageStatus = countBy(
    pilotMessages,
    (row) => `${row.channel}:${row.status}`,
  );
  const whatsappStatus = countBy(whatsappDelivery, (row) => row.status);
  const startedAt = rows.length > 0 ? rows[0].enrolledAt : null;

  return {
    generated_at: new Date().toISOString(),
    experiment_key: experimentKey,
    mode: normalizeMode(rule?.intelligence_mode),
    enabled: Boolean(rule?.enabled),
    rollout_percentage: Number(rule?.rollout_percentage || 0),
    holdout_percentage: Number(rule?.holdout_percentage ?? 10),
    pilot_started_at:
      normalizeMode(rule?.intelligence_mode) === "pilot"
        ? rule?.updated_at || startedAt
        : startedAt,
    maturity_hours: CART_RECOVERY_PILOT_MATURITY_HOURS,
    minimum_sample_per_group: CART_RECOVERY_PILOT_MIN_SAMPLE,
    groups: {
      all: allGroups,
      mature: matureGroups,
    },
    comparison: {
      recovery_rate_pilot: comparison.pilotRate,
      recovery_rate_control: comparison.controlRate,
      uplift_points: comparison.upliftPoints,
      relative_uplift: comparison.relativeUplift,
      revenue_per_cart_pilot: comparison.pilotRevenuePerCart,
      revenue_per_cart_control: comparison.controlRevenuePerCart,
      revenue_per_cart_lift: comparison.revenuePerCartLift,
      estimated_incremental_revenue:
        comparison.revenuePerCartLift * matureGroups.pilot.sample,
      p_value: comparison.pValue,
      confidence: comparison.confidence,
      sample_ready: comparison.sampleReady,
      verdict: comparison.verdict,
    },
    progress: {
      pilot: Math.min(
        1,
        matureGroups.pilot.sample / CART_RECOVERY_PILOT_MIN_SAMPLE,
      ),
      control: Math.min(
        1,
        matureGroups.control.sample / CART_RECOVERY_PILOT_MIN_SAMPLE,
      ),
      estimated_days_remaining: Number.isFinite(estimatedDaysRemaining)
        ? Math.ceil(estimatedDaysRemaining)
        : null,
      enrollment_per_day: enrollmentRate,
    },
    health: {
      queue_total: queue.length,
      queue_status: queueStatus,
      queue_failure_rate: queueFailureRate,
      message_status: messageStatus,
      whatsapp_delivery_status: whatsappStatus,
      healthy:
        (queueStatus.processing || 0) <= 5 &&
        (completedQueue < 20 ? queueFailures <= 1 : queueFailureRate <= 0.05),
    },
    segments: buildSegments(rows),
  };
}

async function loadEnrollmentEvents(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<EnrollmentEvent[]> {
  const rows: EnrollmentEvent[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("cart_recovery_journey_events")
      .select("event_key,cart_id,event_type,metadata,occurred_at")
      .eq("workspace_id", workspaceId)
      .in("event_type", ["pilot_control_enrolled", "pilot_treatment_enrolled"])
      .order("occurred_at", { ascending: true })
      .order("event_key", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data || []) as EnrollmentEvent[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function groupMetrics(rows: CohortRow[], messages: MessageHealth[]) {
  return {
    pilot: cohortMetrics(
      rows.filter((row) => row.cohort === "pilot"),
      messages,
    ),
    control: cohortMetrics(
      rows.filter((row) => row.cohort === "control"),
      messages,
    ),
  };
}

function cohortMetrics(rows: CohortRow[], messages: MessageHealth[]) {
  const enrolledAtByCart = new Map(
    rows.map((row) => [row.cartId, new Date(row.enrolledAt).getTime()]),
  );
  const recoveredRows = rows.filter((row) => isRecoveredAfterEnrollment(row));
  const recoveredValue = recoveredRows.reduce(
    (sum, row) => sum + Number(row.cart?.cart_total || 0),
    0,
  );
  const sentMessages = messages.filter((message) => {
    const enrolledAt = enrolledAtByCart.get(message.cart_id);
    return (
      enrolledAt != null &&
      message.status === "sent" &&
      new Date(message.sent_at).getTime() >= enrolledAt
    );
  }).length;
  const recoveryHours = recoveredRows
    .map((row) => {
      const recoveredAt = new Date(row.cart?.recovered_at || "").getTime();
      const enrolledAt = new Date(row.enrolledAt).getTime();
      return (recoveredAt - enrolledAt) / 3_600_000;
    })
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);

  return {
    sample: rows.length,
    recovered: recoveredRows.length,
    recovery_rate: rows.length > 0 ? recoveredRows.length / rows.length : 0,
    recovered_value: recoveredValue,
    revenue_per_cart: rows.length > 0 ? recoveredValue / rows.length : 0,
    sent_messages: sentMessages,
    messages_per_cart: rows.length > 0 ? sentMessages / rows.length : 0,
    median_recovery_hours: median(recoveryHours),
  };
}

function experimentStats(
  group: ReturnType<typeof cohortMetrics>,
): ExperimentGroupStats {
  return {
    sample: group.sample,
    recovered: group.recovered,
    recoveredValue: group.recovered_value,
  };
}

function isRecoveredAfterEnrollment(row: CohortRow) {
  if (row.cart?.status !== "recovered" || !row.cart.recovered_at) return false;
  const elapsed =
    new Date(row.cart.recovered_at).getTime() -
    new Date(row.enrolledAt).getTime();
  return (
    Number.isFinite(elapsed) &&
    elapsed >= 0 &&
    elapsed <= CART_RECOVERY_PILOT_MATURITY_HOURS * 60 * 60_000
  );
}

function buildSegments(rows: CohortRow[]) {
  const result: Record<
    string,
    {
      pilot: number;
      control: number;
      pilot_recovered: number;
      control_recovered: number;
    }
  > = {};
  for (const row of rows) {
    const key = row.reasonCode || "unknown";
    result[key] ||= {
      pilot: 0,
      control: 0,
      pilot_recovered: 0,
      control_recovered: 0,
    };
    result[key][row.cohort]++;
    if (isRecoveredAfterEnrollment(row)) {
      result[key][`${row.cohort}_recovered`]++;
    }
  }
  return result;
}

async function loadByCartIds<T>(
  admin: SupabaseClient,
  table: string,
  columns: string,
  workspaceId: string,
  cartIds: string[],
): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < cartIds.length; index += 100) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .eq("workspace_id", workspaceId)
      .in(
        table === "abandoned_carts" ? "id" : "cart_id",
        cartIds.slice(index, index + 100),
      );
    if (error) throw error;
    rows.push(...((data || []) as T[]));
  }
  return rows;
}

async function loadByIds<T>(
  admin: SupabaseClient,
  table: string,
  columns: string,
  workspaceId: string,
  ids: string[],
): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .eq("workspace_id", workspaceId)
      .in("id", ids.slice(index, index + 100));
    if (error) throw error;
    rows.push(...((data || []) as T[]));
  }
  return rows;
}

function dailyEnrollmentRate(rows: CohortRow[]) {
  if (rows.length === 0) return { pilot: 0, control: 0 };
  const firstAt = Math.min(
    ...rows.map((row) => new Date(row.enrolledAt).getTime()),
  );
  const days = Math.max(1, (Date.now() - firstAt) / 86_400_000);
  return {
    pilot: rows.filter((row) => row.cohort === "pilot").length / days,
    control: rows.filter((row) => row.cohort === "control").length / days,
  };
}

function estimateDays(remaining: number, perDay: number) {
  if (remaining <= 0) return 0;
  return perDay > 0 ? remaining / perDay : Number.POSITIVE_INFINITY;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
}

function countBy<T>(rows: T[], key: (row: T) => string) {
  return rows.reduce<Record<string, number>>((result, row) => {
    const value = key(row);
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeMode(value: unknown): "shadow" | "pilot" | "active" {
  return value === "pilot" || value === "active" ? value : "shadow";
}

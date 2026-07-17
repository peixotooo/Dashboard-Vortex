import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureRecoveryCoupon } from "./coupons";
import { dispatchEmail, dispatchWhatsApp } from "./dispatch";
import { enrichCart } from "./enrich";
import type { CartIntelligenceDecision } from "./intelligence";
import {
  deleteCartRecoveryMessageReservation,
  finalizeCartRecoveryMessage,
  reserveCartRecoveryMessage,
} from "./message-log";
import {
  cartRecoveryExperimentKey,
  evaluatePilotEligibility,
  pilotQueueBlocksLegacy,
} from "./pilot";
import type { CartRecoveryStep, NormalizedCartItem } from "./types";

type PilotRule = {
  enabled: boolean;
  intelligence_mode?: string;
  rollout_percentage?: number;
  holdout_percentage?: number;
  updated_at?: string;
  current_version?: number;
};

type PilotStep = {
  id: string;
  step_order: number;
  whatsapp_enabled: boolean;
  email_enabled: boolean;
  active?: boolean;
};

type PilotJourney = {
  cart: {
    id: string;
    status: string;
    abandoned_at: string;
    recovery_started_at: string | null;
    has_phone: boolean;
    customer_email?: string;
  };
  intelligence: CartIntelligenceDecision;
};

type QueueRow = {
  id: string;
  cart_id: string;
  step_id: string;
  action_code: string;
  channel: "whatsapp" | "email";
  status: string;
  scheduled_at: string;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown> | null;
};

type DispatchCart = {
  id: string;
  workspace_id: string;
  status: string;
  customer_email: string;
  customer_phone: string | null;
  customer_name: string | null;
  customer_state: string | null;
  customer_region: string | null;
  cart_total: number | null;
  items: NormalizedCartItem[] | null;
  recovery_url: string | null;
  coupon_code: string | null;
  recovery_coupon_expires_at: string | null;
  vnda_client_id: number | null;
  enrichment_attempted_at: string | null;
};

export async function enqueuePilotActions(input: {
  admin: SupabaseClient;
  workspaceId: string;
  rule: PilotRule | null;
  steps: PilotStep[];
  journeys: PilotJourney[];
}) {
  const mode = normalizeMode(input.rule?.intelligence_mode);
  const rolloutPercentage = Number(input.rule?.rollout_percentage || 0);
  const holdoutPercentage = Number(input.rule?.holdout_percentage ?? 10);
  const experimentKey = cartRecoveryExperimentKey(
    Number(input.rule?.current_version || 1),
  );
  if (
    !input.rule?.enabled ||
    mode === "shadow" ||
    rolloutPercentage <= 0 ||
    !input.rule.updated_at
  ) {
    return { eligible: 0, control: 0, pilot: 0, queued: 0 };
  }

  const firstStep =
    input.steps
      .filter((step) => step.active !== false)
      .slice()
      .sort((a, b) => a.step_order - b.step_order)[0] || null;
  const previouslyContacted = firstStep
    ? await loadPreviouslyContactedCartIds({
        admin: input.admin,
        workspaceId: input.workspaceId,
        stepId: firstStep.id,
        cartIds: input.journeys.map((journey) => journey.cart.id),
      })
    : new Set<string>();
  const queueRows: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  let eligible = 0;
  let control = 0;
  let pilot = 0;

  for (const journey of input.journeys) {
    if (previouslyContacted.has(journey.cart.id)) continue;
    const cartStartedAt =
      journey.cart.recovery_started_at || journey.cart.abandoned_at;
    const customerKey = journey.cart.customer_email?.trim().toLowerCase();
    const selection = evaluatePilotEligibility({
      mode,
      ruleEnabled: Boolean(input.rule.enabled),
      rolloutPercentage,
      holdoutPercentage,
      pilotStartedAt: input.rule.updated_at,
      cartId: journey.cart.id,
      assignmentKey: `${experimentKey}:${customerKey || journey.cart.id}`,
      cartStatus: journey.cart.status,
      cartStartedAt,
      hasPhone: journey.cart.has_phone,
      step: firstStep,
      decision: journey.intelligence,
    });
    if (!selection.eligible || selection.cohort === "baseline") continue;

    eligible++;
    const metadata = {
      experiment_key: experimentKey,
      cohort: selection.cohort,
      model_version: journey.intelligence.modelVersion,
      reason_code: journey.intelligence.reason.code,
      action_code: journey.intelligence.action.code,
      confidence: journey.intelligence.reason.confidence,
      lifecycle: journey.intelligence.customer.lifecycle,
      channel: selection.channel,
      scheduled_at: selection.scheduledAt,
      cart_started_at: cartStartedAt,
      rollout_percentage: rolloutPercentage,
      holdout_percentage: holdoutPercentage,
      assignment_unit: customerKey ? "customer" : "cart",
    };

    if (selection.cohort === "control") {
      control++;
      events.push(
        pilotEvent({
          workspaceId: input.workspaceId,
          cartId: journey.cart.id,
          stepId: firstStep?.id || null,
          key: `${experimentKey}:${journey.cart.id}:control`,
          type: "pilot_control_enrolled",
          title: "Controle da régua inteligente",
          status: "control",
          metadata,
        }),
      );
      continue;
    }

    if (!firstStep || !selection.channel || !selection.scheduledAt) continue;
    pilot++;
    const idempotencyKey = [
      experimentKey,
      journey.cart.id,
      firstStep.id,
      selection.channel,
    ].join(":");
    queueRows.push({
      workspace_id: input.workspaceId,
      cart_id: journey.cart.id,
      step_id: firstStep.id,
      idempotency_key: idempotencyKey,
      action_code: journey.intelligence.action.code,
      channel: selection.channel,
      status: "scheduled",
      scheduled_at: selection.scheduledAt,
      payload: metadata,
    });
    events.push(
      pilotEvent({
        workspaceId: input.workspaceId,
        cartId: journey.cart.id,
        stepId: firstStep.id,
        key: `${experimentKey}:${journey.cart.id}:pilot`,
        type: "pilot_treatment_enrolled",
        title: "Piloto da régua inteligente",
        status: "pilot",
        metadata,
      }),
      pilotEvent({
        workspaceId: input.workspaceId,
        cartId: journey.cart.id,
        stepId: firstStep.id,
        key: `${idempotencyKey}:scheduled`,
        type: "pilot_action_scheduled",
        title: "Primeiro contato inteligente programado",
        channel: selection.channel,
        status: "scheduled",
        metadata,
        occurredAt: selection.scheduledAt,
      }),
    );
  }

  let queued = 0;
  if (queueRows.length > 0) {
    const { data, error } = await input.admin
      .from("cart_recovery_action_queue")
      .upsert(queueRows, {
        onConflict: "workspace_id,idempotency_key",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw error;
    queued = data?.length || 0;
  }
  if (events.length > 0) {
    const { error } = await input.admin
      .from("cart_recovery_journey_events")
      .upsert(events, {
        onConflict: "workspace_id,event_key",
        ignoreDuplicates: true,
      });
    if (error) throw error;
  }

  return { eligible, control, pilot, queued };
}

async function loadPreviouslyContactedCartIds(input: {
  admin: SupabaseClient;
  workspaceId: string;
  stepId: string;
  cartIds: string[];
}) {
  const result = new Set<string>();
  for (let index = 0; index < input.cartIds.length; index += 100) {
    const { data, error } = await input.admin
      .from("cart_recovery_messages")
      .select("cart_id")
      .eq("workspace_id", input.workspaceId)
      .eq("step_id", input.stepId)
      .in("cart_id", input.cartIds.slice(index, index + 100));
    if (error) throw error;
    for (const row of data || []) result.add(row.cart_id);
  }
  return result;
}

export async function processPilotActionQueue(input: {
  admin: SupabaseClient;
  workspaceId: string;
  limit?: number;
}) {
  const now = new Date();
  const reconciledFailures = await reconcilePilotWhatsAppFailures(input);
  const staleBefore = new Date(now.getTime() - 30 * 60_000).toISOString();
  await input.admin
    .from("cart_recovery_action_queue")
    .update({
      status: "scheduled",
      locked_at: null,
      updated_at: now.toISOString(),
    })
    .eq("workspace_id", input.workspaceId)
    .eq("status", "processing")
    .lt("locked_at", staleBefore);

  const { data, error } = await input.admin
    .from("cart_recovery_action_queue")
    .select(
      "id,cart_id,step_id,action_code,channel,status,scheduled_at,attempts,max_attempts,payload",
    )
    .eq("workspace_id", input.workspaceId)
    .eq("status", "scheduled")
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(Math.max(1, Math.min(50, input.limit || 20)));
  if (error) throw error;

  const summary = {
    due: data?.length || 0,
    sent: 0,
    retried: 0,
    failed: reconciledFailures,
    canceled: 0,
  };
  for (const candidate of (data || []) as QueueRow[]) {
    const attempts = candidate.attempts + 1;
    const { data: claimed, error: claimError } = await input.admin
      .from("cart_recovery_action_queue")
      .update({
        status: "processing",
        locked_at: now.toISOString(),
        attempts,
        updated_at: now.toISOString(),
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", candidate.id)
      .eq("status", "scheduled")
      .select(
        "id,cart_id,step_id,action_code,channel,status,scheduled_at,attempts,max_attempts,payload",
      )
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) continue;

    const outcome = await dispatchClaimedPilotAction({
      admin: input.admin,
      workspaceId: input.workspaceId,
      queue: claimed as QueueRow,
    });
    summary[outcome]++;
  }
  return summary;
}

async function reconcilePilotWhatsAppFailures(input: {
  admin: SupabaseClient;
  workspaceId: string;
}) {
  const { data, error } = await input.admin
    .from("cart_recovery_action_queue")
    .select(
      "id,cart_id,step_id,action_code,channel,status,scheduled_at,attempts,max_attempts,payload",
    )
    .eq("workspace_id", input.workspaceId)
    .eq("status", "sent")
    .eq("channel", "whatsapp")
    .order("sent_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  const rows = (data || []) as QueueRow[];
  const externalIds = rows
    .map((row) => stringValue(row.payload?.external_id))
    .filter(Boolean);
  if (externalIds.length === 0) return 0;

  const { data: messages, error: messageError } = await input.admin
    .from("wa_messages")
    .select("id,status,error_message")
    .eq("workspace_id", input.workspaceId)
    .in("id", externalIds);
  if (messageError) throw messageError;
  const failedById = new Map(
    (messages || [])
      .filter((message) => message.status === "failed")
      .map((message) => [
        message.id,
        message.error_message || "wa_delivery_failed",
      ]),
  );
  let reconciled = 0;

  for (const row of rows) {
    const externalId = stringValue(row.payload?.external_id);
    const deliveryError = failedById.get(externalId);
    if (!deliveryError) continue;
    const lastError = `wa_delivery_failed:${deliveryError}`.slice(0, 500);
    const { data: updated } = await input.admin
      .from("cart_recovery_action_queue")
      .update({
        status: "failed",
        last_error: lastError,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", row.id)
      .eq("status", "sent")
      .select("id")
      .maybeSingle();
    if (!updated) continue;

    await input.admin
      .from("cart_recovery_messages")
      .delete()
      .eq("workspace_id", input.workspaceId)
      .eq("cart_id", row.cart_id)
      .eq("step_id", row.step_id)
      .eq("channel", "whatsapp");
    await recordQueueEvent(
      { ...input, queue: row },
      "pilot_action_failed",
      "Entrega do WhatsApp falhou",
      "failed",
      { error: lastError, external_id: externalId },
    );
    await recordQueueEvent(
      { ...input, queue: row },
      "pilot_fallback",
      "Retorno automático à régua padrão",
      "fallback",
      { error: lastError },
    );
    reconciled++;
  }
  return reconciled;
}

export async function loadPilotLegacyBlockKeys(input: {
  admin: SupabaseClient;
  workspaceId: string;
  cartIds: string[];
}) {
  const result = new Set<string>();
  if (input.cartIds.length === 0) return result;
  const { data, error } = await input.admin
    .from("cart_recovery_action_queue")
    .select("cart_id,step_id,status")
    .eq("workspace_id", input.workspaceId)
    .in("cart_id", input.cartIds)
    .in("status", ["scheduled", "processing", "sent"]);
  if (error) throw error;
  for (const row of data || []) {
    if (pilotQueueBlocksLegacy(row.status)) {
      result.add(`${row.cart_id}:${row.step_id}`);
    }
  }
  return result;
}

async function dispatchClaimedPilotAction(input: {
  admin: SupabaseClient;
  workspaceId: string;
  queue: QueueRow;
}): Promise<"sent" | "retried" | "failed" | "canceled"> {
  const [cartResult, stepResult] = await Promise.all([
    input.admin
      .from("abandoned_carts")
      .select(
        "id,workspace_id,status,customer_email,customer_phone,customer_name,customer_state,customer_region,cart_total,items,recovery_url,coupon_code,recovery_coupon_expires_at,vnda_client_id,enrichment_attempted_at",
      )
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.queue.cart_id)
      .maybeSingle(),
    input.admin
      .from("cart_recovery_steps")
      .select(
        "id,workspace_id,rule_id,step_order,delay_minutes,whatsapp_enabled,whatsapp_template_id,whatsapp_variable_mapping,email_enabled,email_subject,email_body_html,coupon_pct,coupon_validity_hours,active",
      )
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.queue.step_id)
      .maybeSingle(),
  ]);
  if (cartResult.error) throw cartResult.error;
  if (stepResult.error) throw stepResult.error;
  const cart = cartResult.data as DispatchCart | null;
  const step = stepResult.data as
    | (CartRecoveryStep & { active?: boolean })
    | null;

  if (!cart || cart.status !== "open" || !step || step.active === false) {
    await finishQueue(
      input.admin,
      input.workspaceId,
      input.queue,
      "canceled",
      "cart_or_step_inactive",
    );
    await recordQueueEvent(
      input,
      "pilot_action_canceled",
      "Contato inteligente cancelado",
      "canceled",
    );
    return "canceled";
  }

  let dispatchCart = cart;
  if (
    !cart.enrichment_attempted_at &&
    (!cart.customer_name || !cart.customer_phone || !cart.customer_state)
  ) {
    const enriched = await enrichCart(input.admin, input.workspaceId, cart);
    dispatchCart = {
      ...cart,
      customer_name: enriched.customer_name,
      customer_phone: enriched.customer_phone,
      customer_state: enriched.customer_state,
      customer_region: enriched.customer_region,
    };
  }

  if ((step.coupon_pct || 0) > 0) {
    const coupon = await ensureRecoveryCoupon(
      input.admin,
      input.workspaceId,
      {
        id: cart.id,
        coupon_code: dispatchCart.coupon_code,
        recovery_coupon_expires_at: dispatchCart.recovery_coupon_expires_at,
      },
      {
        pct: step.coupon_pct,
        validityHours: step.coupon_validity_hours || 48,
      },
    );
    if (coupon) {
      dispatchCart = {
        ...dispatchCart,
        coupon_code: coupon.code,
        recovery_coupon_expires_at: coupon.expiresAt,
      };
    }
  }

  const reservation = await reserveCartRecoveryMessage(input.admin, {
    workspaceId: input.workspaceId,
    cartId: cart.id,
    stepId: step.id,
    channel: input.queue.channel,
  });
  if (!reservation.reserved) {
    const { data: existing } = await input.admin
      .from("cart_recovery_messages")
      .select("status,external_id")
      .eq("workspace_id", input.workspaceId)
      .eq("cart_id", cart.id)
      .eq("step_id", step.id)
      .eq("channel", input.queue.channel)
      .maybeSingle();
    if (existing?.status === "sent") {
      await finishQueue(
        input.admin,
        input.workspaceId,
        input.queue,
        "sent",
        null,
        existing.external_id,
      );
      await recordQueueEvent(
        input,
        "pilot_action_sent",
        "Contato inteligente enviado",
        "sent",
      );
      return "sent";
    }
    return retryOrFallback(input, "message_reservation_busy");
  }

  const result =
    input.queue.channel === "whatsapp"
      ? await dispatchWhatsApp({
          admin: input.admin,
          workspaceId: input.workspaceId,
          cart: dispatchCart,
          step,
        })
      : await dispatchEmail({
          admin: input.admin,
          workspaceId: input.workspaceId,
          cart: dispatchCart,
          step,
        });

  if (!result.ok) {
    await deleteCartRecoveryMessageReservation(
      input.admin,
      input.workspaceId,
      reservation.id,
    );
    return retryOrFallback(input, result.error || "dispatch_failed");
  }

  await finalizeCartRecoveryMessage(
    input.admin,
    input.workspaceId,
    reservation.id,
    result,
  );
  await finishQueue(
    input.admin,
    input.workspaceId,
    input.queue,
    "sent",
    null,
    result.externalId,
  );
  await recordQueueEvent(
    input,
    "pilot_action_sent",
    "Contato inteligente enviado",
    "sent",
    {
      external_id: result.externalId || null,
    },
  );
  return "sent";
}

async function retryOrFallback(
  input: {
    admin: SupabaseClient;
    workspaceId: string;
    queue: QueueRow;
  },
  error: string,
): Promise<"retried" | "failed"> {
  const retryable = isRetryablePilotError(error);
  if (retryable && input.queue.attempts < input.queue.max_attempts) {
    const delayMinutes = Math.min(
      30,
      5 * 2 ** Math.max(0, input.queue.attempts - 1),
    );
    await input.admin
      .from("cart_recovery_action_queue")
      .update({
        status: "scheduled",
        scheduled_at: new Date(
          Date.now() + delayMinutes * 60_000,
        ).toISOString(),
        locked_at: null,
        last_error: error,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.queue.id);
    await recordQueueEvent(
      input,
      "pilot_action_retry",
      "Contato inteligente reagendado",
      "scheduled",
      {
        error,
        retry_in_minutes: delayMinutes,
      },
    );
    return "retried";
  }

  await finishQueue(
    input.admin,
    input.workspaceId,
    input.queue,
    "failed",
    error,
  );
  await recordQueueEvent(
    input,
    "pilot_action_failed",
    "Contato inteligente falhou",
    "failed",
    {
      error,
    },
  );
  await recordQueueEvent(
    input,
    "pilot_fallback",
    "Retorno automático à régua padrão",
    "fallback",
    {
      error,
    },
  );
  return "failed";
}

async function finishQueue(
  admin: SupabaseClient,
  workspaceId: string,
  queue: QueueRow,
  status: "sent" | "failed" | "canceled",
  lastError: string | null,
  externalId?: string | null,
) {
  const now = new Date().toISOString();
  const payload = {
    ...(queue.payload || {}),
    ...(externalId ? { external_id: externalId } : {}),
  };
  await admin
    .from("cart_recovery_action_queue")
    .update({
      status,
      locked_at: null,
      last_error: lastError,
      sent_at: status === "sent" ? now : null,
      payload,
      updated_at: now,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", queue.id);
}

async function recordQueueEvent(
  input: {
    admin: SupabaseClient;
    workspaceId: string;
    queue: QueueRow;
  },
  eventType: string,
  title: string,
  status: string,
  metadata: Record<string, unknown> = {},
) {
  const event = pilotEvent({
    workspaceId: input.workspaceId,
    cartId: input.queue.cart_id,
    stepId: input.queue.step_id,
    key: `${queueExperimentKey(input.queue)}:${input.queue.id}:${eventType}:${input.queue.attempts}`,
    type: eventType,
    title,
    channel: input.queue.channel,
    status,
    metadata: {
      ...(input.queue.payload || {}),
      queue_id: input.queue.id,
      attempts: input.queue.attempts,
      ...metadata,
    },
  });
  await input.admin.from("cart_recovery_journey_events").upsert(event, {
    onConflict: "workspace_id,event_key",
    ignoreDuplicates: true,
  });
}

function pilotEvent(input: {
  workspaceId: string;
  cartId: string;
  stepId: string | null;
  key: string;
  type: string;
  title: string;
  channel?: "whatsapp" | "email" | "system";
  status: string;
  metadata: Record<string, unknown>;
  occurredAt?: string;
}) {
  return {
    workspace_id: input.workspaceId,
    cart_id: input.cartId,
    step_id: input.stepId,
    event_key: input.key,
    event_type: input.type,
    title: input.title,
    channel: input.channel || "system",
    status: input.status,
    metadata: input.metadata,
    occurred_at: input.occurredAt || new Date().toISOString(),
  };
}

function isRetryablePilotError(error: string) {
  const value = error.toLowerCase();
  return (
    value === "template_pending" ||
    value === "fetch failed" ||
    value === "network_error" ||
    value === "message_reservation_busy" ||
    value.includes("timeout") ||
    value.includes("econnreset") ||
    value.includes("etimedout") ||
    value.startsWith("http 429") ||
    /^http 5\d\d/.test(value)
  );
}

function normalizeMode(value: unknown): "shadow" | "pilot" | "active" {
  return value === "pilot" || value === "active" ? value : "shadow";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function queueExperimentKey(queue: QueueRow) {
  return (
    stringValue(queue.payload?.experiment_key) || cartRecoveryExperimentKey(1)
  );
}

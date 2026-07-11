import { createAdminClient } from "@/lib/supabase-admin";
import {
  buildCartCustomerProfile,
  evaluateCartIntelligence,
  type CartIntelligenceDecision,
  type CheckoutJourneySignal,
} from "@/lib/cart-recovery/intelligence";
import type { NormalizedCartItem } from "@/lib/cart-recovery/types";
import {
  FREE_SHIPPING_THRESHOLDS_BRL,
  freeShippingThresholdForRegion,
} from "@/lib/cart-recovery/location";

type AdminClient = ReturnType<typeof createAdminClient>;
type IntelligenceMode = "shadow" | "pilot" | "active";

type CartRow = {
  id: string;
  customer_email: string;
  customer_phone: string | null;
  customer_name: string | null;
  customer_state: string | null;
  customer_region: string | null;
  cart_total: number | null;
  status: string;
  abandoned_at: string;
  recovered_at: string | null;
  recovery_started_at: string | null;
  recovery_url: string | null;
  coupon_code: string | null;
  items: Array<Partial<NormalizedCartItem> & Record<string, unknown>> | null;
  raw_payload: Record<string, unknown> | null;
  updated_at: string;
};

type StepRow = {
  id: string;
  step_order: number;
  delay_minutes: number;
  whatsapp_enabled: boolean;
  email_enabled: boolean;
  coupon_pct: number;
  coupon_validity_hours: number;
  active?: boolean;
};

type MessageRow = {
  id: string;
  cart_id: string;
  step_id: string;
  channel: "whatsapp" | "email";
  status: string;
  error: string | null;
  external_id: string | null;
  sent_at: string;
  rendered_payload: Record<string, unknown> | null;
};

type OrderRow = {
  email: string | null;
  data_compra: string | null;
  valor: number | null;
  cupom: string | null;
};

type AttributionRow = { email: string; consumer_id: string | null };

type CheckoutRow = {
  session_id: string;
  consumer_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  purchased: boolean;
  last_step: string | null;
  last_field_key: string | null;
  payment_method: string | null;
  shipping_method: string | null;
  fields_errored: Record<string, number> | null;
  error_codes: Record<string, number> | null;
  tracker_versions?: Record<string, number> | null;
};

type RuleRow = {
  id: string;
  enabled: boolean;
  expire_after_hours: number;
  intelligence_mode?: string;
  rollout_percentage?: number;
  holdout_percentage?: number;
  free_shipping_threshold?: number;
  free_shipping_thresholds?: Record<string, number>;
  current_version?: number;
};

type PersistedIntelligenceRow = {
  cart_id: string;
  model_version: string;
  mode: IntelligenceMode;
  lifecycle: string;
  reason_code: string;
  reason_label: string;
  confidence: number;
  evidence: unknown;
  action_code: string;
  action_label: string;
  action: unknown;
  context: unknown;
  computed_at: string;
};

type JourneyResult = {
  cart: {
    id: string;
    customer_name: string | null;
    customer_email: string;
    customer_state: string | null;
    customer_region: string | null;
    cart_total: number | null;
    status: string;
    abandoned_at: string;
    recovered_at: string | null;
    recovery_started_at: string | null;
    recovery_url: string | null;
    coupon_code: string | null;
    has_phone: boolean;
    items: Array<{
      name: string | null;
      sku: string | null;
      quantity: number;
      price: number | null;
      image_url: string | null;
    }>;
  };
  intelligence: ReturnType<typeof evaluateCartIntelligence>;
  messages: Array<{
    id: string;
    step_id: string;
    step_order: number | null;
    delay_minutes: number | null;
    channel: "whatsapp" | "email";
    status: string;
    error: string | null;
    external_id: string | null;
    sent_at: string;
    preview: string;
  }>;
};

const EMPTY_CHECKOUT: CheckoutJourneySignal = {
  sessionId: null,
  linked: false,
  gapMinutes: null,
  purchased: false,
  lastStep: null,
  lastFieldKey: null,
  paymentMethod: null,
  shippingMethod: null,
  fieldsErrored: {},
  errorCodes: {},
};

export async function buildCartRecoveryJourneyPayload(input: {
  admin: AdminClient;
  workspaceId: string;
  limit?: number;
  status?: string | null;
  persist?: boolean;
  preferPersisted?: boolean;
}) {
  const { admin, workspaceId } = input;
  const limit = Math.max(10, Math.min(300, Number(input.limit || 60)));

  let cartQuery = admin
    .from("abandoned_carts")
    .select(
      "id,customer_email,customer_phone,customer_name,customer_state,customer_region,cart_total,status,abandoned_at,recovered_at,recovery_started_at,recovery_url,coupon_code,items,raw_payload,updated_at"
    )
    .eq("workspace_id", workspaceId)
    .order("abandoned_at", { ascending: false })
    .limit(limit);
  if (input.status && input.status !== "all") {
    cartQuery = cartQuery.eq("status", input.status);
  }

  const [cartsResult, rule] = await Promise.all([
    cartQuery,
    loadRule(admin, workspaceId),
  ]);
  if (cartsResult.error) throw cartsResult.error;

  const mode = normalizeMode(rule?.intelligence_mode);
  const carts = (cartsResult.data || []) as CartRow[];
  if (carts.length === 0) {
    return {
      generated_at: new Date().toISOString(),
      mode,
      strategy: strategyPayload(rule, []),
      summary: emptySummary(),
      journeys: [],
    };
  }

  const cartIds = carts.map((cart) => cart.id);
  const emails = unique(carts.map((cart) => normalizeEmail(cart.customer_email)));
  const [allSteps, messages] = await Promise.all([
    loadSteps(admin, rule?.id || null),
    loadMessages(admin, workspaceId, cartIds),
  ]);
  const activeSteps = allSteps.filter((step) => step.active !== false);
  const stepById = new Map(allSteps.map((step) => [step.id, step]));
  const messagesByCart = groupBy(messages, (row) => row.cart_id);

  if (input.preferPersisted) {
    const persistedJourneys = await loadPersistedJourneys({
      admin,
      workspaceId,
      carts,
      messagesByCart,
      stepById,
    });
    if (persistedJourneys) {
      return {
        generated_at: new Date().toISOString(),
        mode,
        source: "worker_snapshot",
        strategy: strategyPayload(rule, activeSteps),
        summary: summarizeJourneys(persistedJourneys),
        journeys: persistedJourneys,
      };
    }
  }

  const [attributions, orders] = await Promise.all([
    loadAttributions(admin, workspaceId, emails),
    loadOrders(admin, workspaceId, emails),
  ]);

  const consumerIds = unique(
    attributions.map((row) => row.consumer_id || "").filter(Boolean)
  );
  const [checkoutRows, hubOnDemandSkus] = await Promise.all([
    loadCheckoutRows(
      admin,
      workspaceId,
      consumerIds,
      earliestCheckoutDate(carts)
    ),
    loadOnDemandSkus(admin, workspaceId, collectCartSkus(carts)),
  ]);

  const attrByEmail = new Map(
    attributions.map((row) => [normalizeEmail(row.email), row.consumer_id])
  );
  const ordersByEmail = groupBy(orders, (row) => normalizeEmail(row.email || ""));
  const checkoutByConsumer = groupBy(
    checkoutRows.filter((row) => Boolean(row.consumer_id)),
    (row) => row.consumer_id || ""
  );
  const journeys = carts.map((cart) => {
    const abandonedAtMs = new Date(cart.abandoned_at).getTime();
    const priorOrders = (ordersByEmail.get(normalizeEmail(cart.customer_email)) || [])
      .filter((order) => {
        const orderAt = new Date(order.data_compra || "").getTime();
        return Number.isFinite(orderAt) && orderAt < abandonedAtMs - 5 * 60 * 1000;
      });
    const customer = buildCartCustomerProfile({
      priorOrders: priorOrders.length,
      priorRevenue: priorOrders.reduce(
        (sum, order) => sum + Math.max(0, Number(order.valor || 0)),
        0
      ),
      priorCouponOrders: priorOrders.filter((order) => Boolean(order.cupom)).length,
    });
    const consumerId = attrByEmail.get(normalizeEmail(cart.customer_email)) || null;
    const checkout = chooseCheckoutSession(
      cart,
      consumerId ? checkoutByConsumer.get(consumerId) || [] : []
    );
    const intelligence = evaluateCartIntelligence({
      status: cart.status,
      cartTotal: cart.cart_total,
      hasPhone: Boolean(cart.customer_phone),
      rawPayload: cart.raw_payload,
      normalizedItems: Array.isArray(cart.items) ? cart.items : [],
      hubOnDemandSkus,
      customer,
      checkout,
      freeShippingThreshold:
        freeShippingThresholdForRegion(
          cart.customer_region || cart.customer_state,
          rule?.free_shipping_thresholds || FREE_SHIPPING_THRESHOLDS_BRL
        ) || Number(rule?.free_shipping_threshold || 299),
      mode,
    });
    return {
      cart: serializeCart(cart),
      intelligence,
      messages: serializeMessages(messagesByCart.get(cart.id) || [], stepById),
    };
  });

  if (input.persist) {
    await persistJourneyState({
      admin,
      workspaceId,
      journeys,
      holdoutPercentage: Number(rule?.holdout_percentage || 10),
    });
  }

  return {
    generated_at: new Date().toISOString(),
    mode,
    source: "live_fallback",
    strategy: strategyPayload(rule, activeSteps),
    summary: summarizeJourneys(journeys),
    journeys,
  };
}

async function loadRule(admin: AdminClient, workspaceId: string): Promise<RuleRow | null> {
  const versioned = await admin
    .from("cart_recovery_rules")
    .select(
      "id,enabled,expire_after_hours,intelligence_mode,rollout_percentage,holdout_percentage,free_shipping_threshold,free_shipping_thresholds,current_version"
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!versioned.error) return versioned.data as RuleRow | null;

  const legacy = await admin
    .from("cart_recovery_rules")
    .select("id,enabled,expire_after_hours")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (legacy.error) throw legacy.error;
  return legacy.data as RuleRow | null;
}

async function loadSteps(admin: AdminClient, ruleId: string | null): Promise<StepRow[]> {
  if (!ruleId) return [];
  const columns =
    "id,step_order,delay_minutes,whatsapp_enabled,email_enabled,coupon_pct,coupon_validity_hours";
  const versioned = await admin
    .from("cart_recovery_steps")
    .select(`${columns},active`)
    .eq("rule_id", ruleId)
    .order("step_order");
  if (!versioned.error) return (versioned.data || []) as StepRow[];

  const legacy = await admin
    .from("cart_recovery_steps")
    .select(columns)
    .eq("rule_id", ruleId)
    .order("step_order");
  if (legacy.error) throw legacy.error;
  return (legacy.data || []) as StepRow[];
}

async function loadMessages(
  admin: AdminClient,
  workspaceId: string,
  cartIds: string[]
): Promise<MessageRow[]> {
  if (cartIds.length === 0) return [];
  const { data, error } = await admin
    .from("cart_recovery_messages")
    .select(
      "id,cart_id,step_id,channel,status,error,external_id,sent_at,rendered_payload"
    )
    .eq("workspace_id", workspaceId)
    .in("cart_id", cartIds)
    .order("sent_at", { ascending: true });
  if (error) throw error;
  return (data || []) as MessageRow[];
}

async function loadPersistedJourneys(input: {
  admin: AdminClient;
  workspaceId: string;
  carts: CartRow[];
  messagesByCart: Map<string, MessageRow[]>;
  stepById: Map<string, StepRow>;
}): Promise<JourneyResult[] | null> {
  if (input.carts.length === 0) return [];
  const { data, error } = await input.admin
    .from("cart_recovery_intelligence")
    .select(
      "cart_id,model_version,mode,lifecycle,reason_code,reason_label,confidence,evidence,action_code,action_label,action,context,computed_at"
    )
    .eq("workspace_id", input.workspaceId)
    .in("cart_id", input.carts.map((cart) => cart.id));
  if (error) return null;

  const rows = (data || []) as PersistedIntelligenceRow[];
  if (rows.length !== input.carts.length) return null;
  const byCart = new Map(rows.map((row) => [row.cart_id, row]));
  const maxAgeMs = 15 * 60 * 1000;
  const now = Date.now();
  const journeys: JourneyResult[] = [];

  for (const cart of input.carts) {
    const row = byCart.get(cart.id);
    if (!row) return null;
    const computedAt = new Date(row.computed_at).getTime();
    const cartUpdatedAt = new Date(cart.updated_at).getTime();
    if (
      !Number.isFinite(computedAt) ||
      now - computedAt > maxAgeMs ||
      (Number.isFinite(cartUpdatedAt) && computedAt + 1000 < cartUpdatedAt)
    ) {
      return null;
    }

    const context = isRecord(row.context) ? row.context : null;
    if (
      !context ||
      !isRecord(context.customer) ||
      !isRecord(context.checkout) ||
      !isRecord(context.commerce) ||
      !isRecord(row.action)
    ) {
      return null;
    }

    const intelligence: CartIntelligenceDecision = {
      modelVersion: row.model_version,
      mode: normalizeMode(row.mode),
      reason: {
        code: row.reason_code as CartIntelligenceDecision["reason"]["code"],
        label: row.reason_label,
        confidence: Number(row.confidence || 0),
        evidence: (Array.isArray(row.evidence) ? row.evidence : []) as CartIntelligenceDecision["reason"]["evidence"],
      },
      alternatives: (Array.isArray(context.alternatives)
        ? context.alternatives
        : []) as CartIntelligenceDecision["alternatives"],
      action: row.action as unknown as CartIntelligenceDecision["action"],
      customer: context.customer as unknown as CartIntelligenceDecision["customer"],
      checkout: context.checkout as unknown as CartIntelligenceDecision["checkout"],
      commerce: context.commerce as unknown as CartIntelligenceDecision["commerce"],
    };

    journeys.push({
      cart: serializeCart(cart),
      intelligence,
      messages: serializeMessages(
        input.messagesByCart.get(cart.id) || [],
        input.stepById
      ),
    });
  }

  return journeys;
}

async function loadAttributions(
  admin: AdminClient,
  workspaceId: string,
  emails: string[]
): Promise<AttributionRow[]> {
  if (emails.length === 0) return [];
  const { data, error } = await admin
    .from("meta_attribution")
    .select("email,consumer_id")
    .eq("workspace_id", workspaceId)
    .in("email", emails);
  if (error) throw error;
  return (data || []) as AttributionRow[];
}

async function loadOrders(
  admin: AdminClient,
  workspaceId: string,
  emails: string[]
): Promise<OrderRow[]> {
  const rows: OrderRow[] = [];
  for (let index = 0; index < emails.length; index += 80) {
    const { data, error } = await admin
      .from("crm_vendas")
      .select("email,data_compra,valor,cupom")
      .eq("workspace_id", workspaceId)
      .in("email", emails.slice(index, index + 80))
      .order("data_compra", { ascending: true })
      .limit(5000);
    if (error) throw error;
    rows.push(...((data || []) as OrderRow[]));
  }
  return rows;
}

async function loadCheckoutRows(
  admin: AdminClient,
  workspaceId: string,
  consumerIds: string[],
  sinceIso: string
): Promise<CheckoutRow[]> {
  if (consumerIds.length === 0) return [];
  const rows: CheckoutRow[] = [];
  for (let index = 0; index < consumerIds.length; index += 80) {
    const batch = consumerIds.slice(index, index + 80);
    for (let from = 0; from < 5000; from += 1000) {
      const versioned = await admin
        .from("checkout_session_rollups")
        .select(
          "session_id,consumer_id,first_seen_at,last_seen_at,purchased,last_step,last_field_key,payment_method,shipping_method,fields_errored,error_codes,tracker_versions"
        )
        .eq("workspace_id", workspaceId)
        .in("consumer_id", batch)
        .gte("first_seen_at", sinceIso)
        .order("first_seen_at", { ascending: false })
        .range(from, from + 999);
      const legacy = versioned.error
        ? await admin
            .from("checkout_session_rollups")
            .select(
              "session_id,consumer_id,first_seen_at,last_seen_at,purchased,last_step,last_field_key,payment_method,shipping_method,fields_errored,error_codes"
            )
            .eq("workspace_id", workspaceId)
            .in("consumer_id", batch)
            .gte("first_seen_at", sinceIso)
            .order("first_seen_at", { ascending: false })
            .range(from, from + 999)
        : null;
      const data = versioned.error ? legacy?.data : versioned.data;
      const error = versioned.error ? legacy?.error : null;
      if (error) throw error;
      rows.push(...((data || []) as CheckoutRow[]));
      if (!data || data.length < 1000) break;
    }
  }
  return rows;
}

async function loadOnDemandSkus(
  admin: AdminClient,
  workspaceId: string,
  skus: string[]
): Promise<Set<string>> {
  const result = new Set<string>();
  for (let index = 0; index < skus.length; index += 100) {
    const { data, error } = await admin
      .from("hub_products")
      .select("sku,sob_demanda")
      .eq("workspace_id", workspaceId)
      .eq("sob_demanda", true)
      .in("sku", skus.slice(index, index + 100));
    if (error) throw error;
    for (const row of data || []) if (row.sku) result.add(String(row.sku));
  }
  return result;
}

async function persistJourneyState(input: {
  admin: AdminClient;
  workspaceId: string;
  journeys: JourneyResult[];
  holdoutPercentage: number;
}) {
  const { admin, workspaceId, journeys } = input;
  const now = new Date().toISOString();
  const intelligenceRows = journeys.map((journey) => ({
    cart_id: journey.cart.id,
    workspace_id: workspaceId,
    model_version: journey.intelligence.modelVersion,
    mode: journey.intelligence.mode,
    lifecycle: journey.intelligence.customer.lifecycle,
    reason_code: journey.intelligence.reason.code,
    reason_label: journey.intelligence.reason.label,
    confidence: journey.intelligence.reason.confidence,
    evidence: journey.intelligence.reason.evidence,
    action_code: journey.intelligence.action.code,
    action_label: journey.intelligence.action.label,
    action: journey.intelligence.action,
    context: {
      customer: journey.intelligence.customer,
      checkout: journey.intelligence.checkout,
      commerce: journey.intelligence.commerce,
      alternatives: journey.intelligence.alternatives,
    },
    computed_at: now,
    updated_at: now,
  }));
  if (intelligenceRows.length > 0) {
    const { error } = await admin
      .from("cart_recovery_intelligence")
      .upsert(intelligenceRows, { onConflict: "cart_id" });
    if (error) throw error;
  }

  const experimentKey = "cart-intelligence-rules-v1";
  const holdout = Math.max(0, Math.min(50, input.holdoutPercentage));
  const assignments = journeys.map((journey) => ({
    cart_id: journey.cart.id,
    workspace_id: workspaceId,
    experiment_key: experimentKey,
    cohort: stableBucket(journey.cart.id) < holdout ? "control" : "treatment",
  }));
  if (assignments.length > 0) {
    const { error } = await admin
      .from("cart_recovery_experiment_assignments")
      .upsert(assignments, { onConflict: "cart_id", ignoreDuplicates: true });
    if (error) throw error;
  }

  const events = journeys.flatMap((journey) => journeyEvents(workspaceId, journey));
  if (events.length > 0) {
    const { error } = await admin
      .from("cart_recovery_journey_events")
      .upsert(events, {
        onConflict: "workspace_id,event_key",
        ignoreDuplicates: true,
      });
    if (error) throw error;
  }
}

function journeyEvents(workspaceId: string, journey: JourneyResult) {
  const decision = journey.intelligence;
  const checkoutKey = decision.checkout.sessionId || "no-session";
  const rows: Array<Record<string, unknown>> = [
    {
      workspace_id: workspaceId,
      cart_id: journey.cart.id,
      event_key: `cart:${journey.cart.id}:captured`,
      event_type: "cart_captured",
      title: "Carrinho capturado",
      channel: "system",
      status: "completed",
      metadata: { cart_total: journey.cart.cart_total, items_count: journey.cart.items.length },
      occurred_at: journey.cart.abandoned_at,
    },
    {
      workspace_id: workspaceId,
      cart_id: journey.cart.id,
      event_key: `cart:${journey.cart.id}:decision:${decision.modelVersion}:${decision.reason.code}:${decision.action.code}:${checkoutKey}`,
      event_type: "decision_computed",
      title: decision.reason.label,
      detail: decision.action.label,
      channel: "system",
      status: decision.mode,
      metadata: {
        model_version: decision.modelVersion,
        confidence: decision.reason.confidence,
        reason_code: decision.reason.code,
        action_code: decision.action.code,
        checkout_session_id: decision.checkout.sessionId,
      },
      occurred_at: new Date().toISOString(),
    },
  ];

  for (const message of journey.messages) {
    rows.push({
      workspace_id: workspaceId,
      cart_id: journey.cart.id,
      step_id: message.step_id,
      event_key: `cart:${journey.cart.id}:message:${message.id}`,
      event_type: "message_dispatch",
      title: message.channel === "whatsapp" ? "WhatsApp" : "Email",
      detail: message.status,
      channel: message.channel,
      status: message.status,
      metadata: { external_id: message.external_id, error: message.error },
      occurred_at: message.sent_at,
    });
  }
  if (journey.cart.status === "recovered" && journey.cart.recovered_at) {
    rows.push({
      workspace_id: workspaceId,
      cart_id: journey.cart.id,
      event_key: `cart:${journey.cart.id}:recovered`,
      event_type: "cart_recovered",
      title: "Compra confirmada",
      channel: "system",
      status: "recovered",
      metadata: { cart_total: journey.cart.cart_total },
      occurred_at: journey.cart.recovered_at,
    });
  }
  return rows;
}

function chooseCheckoutSession(cart: CartRow, rows: CheckoutRow[]): CheckoutJourneySignal {
  if (rows.length === 0) return { ...EMPTY_CHECKOUT };
  const cartAt = new Date(cart.abandoned_at).getTime();
  // A mesma identidade pode voltar ao checkout em dias diferentes. Depois de
  // 12h, a chance de ligar o carrinho à sessão errada passa a ser maior que o
  // ganho de cobertura, então deixamos explicitamente como "sem vínculo".
  const maxGapMs = 12 * 60 * 60 * 1000;
  const selected = rows
    .map((row) => {
      const firstAt = new Date(row.first_seen_at).getTime();
      const lastAt = new Date(row.last_seen_at).getTime();
      const gap = cartAt < firstAt ? firstAt - cartAt : cartAt > lastAt ? cartAt - lastAt : 0;
      const futurePenalty = firstAt > cartAt + 2 * 60 * 60 * 1000 ? maxGapMs : 0;
      const purchasePenalty = row.purchased ? 6 * 60 * 60 * 1000 : 0;
      return { row, gap, score: gap + futurePenalty + purchasePenalty };
    })
    .filter((candidate) => candidate.gap <= maxGapMs)
    .sort((a, b) => a.score - b.score)[0];
  if (!selected) return { ...EMPTY_CHECKOUT };
  return {
    sessionId: selected.row.session_id,
    linked: true,
    gapMinutes: Math.round(selected.gap / 60000),
    purchased: Boolean(selected.row.purchased),
    lastStep: selected.row.last_step,
    lastFieldKey: selected.row.last_field_key,
    paymentMethod: selected.row.payment_method,
    shippingMethod: selected.row.shipping_method,
    fieldsErrored: selected.row.fields_errored || {},
    errorCodes: selected.row.error_codes || {},
    trackerVersions: Object.keys(selected.row.tracker_versions || {}),
  };
}

function strategyPayload(rule: RuleRow | null, steps: StepRow[]) {
  return {
    enabled: Boolean(rule?.enabled),
    expire_after_hours: rule?.expire_after_hours || 168,
    current_version: rule?.current_version || 1,
    rollout_percentage: rule?.rollout_percentage || 0,
    holdout_percentage: rule?.holdout_percentage ?? 10,
    free_shipping_threshold: Number(rule?.free_shipping_threshold || 299),
    free_shipping_thresholds:
      rule?.free_shipping_thresholds || FREE_SHIPPING_THRESHOLDS_BRL,
    steps,
  };
}

function collectCartSkus(carts: CartRow[]): string[] {
  return unique(carts.flatMap((cart) => {
    const rawItems = parseItems(cart.raw_payload?.items);
    const items = rawItems.length > 0 ? rawItems : cart.items || [];
    return items
      .map((item) => stringOrNull(item.variant_sku) || stringOrNull(item.sku) || "")
      .filter(Boolean);
  }));
}

function earliestCheckoutDate(carts: CartRow[]): string {
  const earliest = Math.min(
    ...carts.map((cart) => new Date(cart.abandoned_at).getTime()).filter(Number.isFinite)
  );
  return new Date((Number.isFinite(earliest) ? earliest : Date.now()) - 2 * 86400000).toISOString();
}

function serializeCart(cart: CartRow): JourneyResult["cart"] {
  return {
    id: cart.id,
    customer_name: cart.customer_name,
    customer_email: cart.customer_email,
    customer_state: cart.customer_state,
    customer_region: cart.customer_region,
    cart_total: cart.cart_total,
    status: cart.status,
    abandoned_at: cart.abandoned_at,
    recovered_at: cart.recovered_at,
    recovery_started_at: cart.recovery_started_at,
    recovery_url: cart.recovery_url,
    coupon_code: cart.coupon_code,
    has_phone: Boolean(cart.customer_phone),
    items: (Array.isArray(cart.items) ? cart.items : []).slice(0, 8).map((item) => ({
      name: stringOrNull(item.name),
      sku: stringOrNull(item.sku),
      quantity: numberOrNull(item.quantity) || 1,
      price: numberOrNull(item.price),
      image_url: stringOrNull(item.image_url),
    })),
  };
}

function serializeMessages(
  messages: MessageRow[],
  stepById: Map<string, StepRow>
): JourneyResult["messages"] {
  return messages.map((message) => {
    const step = stepById.get(message.step_id);
    return {
      id: message.id,
      step_id: message.step_id,
      step_order: step?.step_order || null,
      delay_minutes: step?.delay_minutes || null,
      channel: message.channel,
      status: message.status,
      error: message.error,
      external_id: message.external_id,
      sent_at: message.sent_at,
      preview: messagePreview(message),
    };
  });
}

function messagePreview(message: MessageRow): string {
  const payload = message.rendered_payload || {};
  const body = stringOrNull(payload.body) || stringOrNull(payload.body_html) ||
    stringOrNull(payload.subject) || message.error || "Sem conteúdo registrado";
  return stripHtml(body).slice(0, 1200);
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parseItems(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function summarizeJourneys(journeys: JourneyResult[]) {
  const reasonCounts: Record<string, number> = {};
  let highConfidence = 0;
  let linkedCheckout = 0;
  let recurring = 0;
  let recovered = 0;
  let sentMessages = 0;
  for (const journey of journeys) {
    const reason = journey.intelligence.reason.code;
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    if (journey.intelligence.reason.confidence >= 0.8) highConfidence++;
    if (journey.intelligence.checkout.linked) linkedCheckout++;
    if (journey.intelligence.customer.priorOrders > 0) recurring++;
    if (journey.cart.status === "recovered") recovered++;
    sentMessages += journey.messages.filter((message) => message.status === "sent").length;
  }
  return {
    carts: journeys.length,
    high_confidence: highConfidence,
    linked_checkout: linkedCheckout,
    recurring,
    recovered,
    sent_messages: sentMessages,
    reason_counts: reasonCounts,
  };
}

function emptySummary() {
  return {
    carts: 0,
    high_confidence: 0,
    linked_checkout: 0,
    recurring: 0,
    recovered: 0,
    sent_messages: 0,
    reason_counts: {},
  };
}

function stableBucket(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 100;
}

function normalizeMode(value: unknown): IntelligenceMode {
  return value === "pilot" || value === "active" ? value : "shadow";
}

function normalizeEmail(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    result.set(value, [...(result.get(value) || []), row]);
  }
  return result;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

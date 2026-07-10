import type { NormalizedCartItem } from "./types";

export type CartCustomerLifecycle = "new" | "returning" | "loyal" | "vip";

export type CartAbandonmentReasonCode =
  | "payment_failed"
  | "shipping_unavailable"
  | "shipping_cost"
  | "delivery_time"
  | "on_demand"
  | "stock_wait"
  | "coupon_friction"
  | "form_friction"
  | "payment_choice"
  | "shipping_choice"
  | "low_intent"
  | "unknown";

export type CartDecisionActionCode =
  | "cancel_recovery"
  | "resume_payment"
  | "show_shipping_options"
  | "explain_delivery_and_alternatives"
  | "resolve_coupon"
  | "reduce_checkout_friction"
  | "resume_checkout"
  | "gentle_reminder"
  | "wait_and_observe";

export interface CartEvidence {
  key: string;
  label: string;
  value: string;
  strength: "strong" | "supporting" | "context";
}

export interface CartCustomerProfile {
  lifecycle: CartCustomerLifecycle;
  priorOrders: number;
  priorRevenue: number;
  priorCouponOrders: number;
  couponSensitivity: "unknown" | "low" | "medium" | "high";
}

export interface CheckoutJourneySignal {
  sessionId: string | null;
  linked: boolean;
  gapMinutes: number | null;
  purchased: boolean;
  lastStep: string | null;
  lastFieldKey: string | null;
  paymentMethod: string | null;
  shippingMethod: string | null;
  fieldsErrored: Record<string, number>;
  errorCodes: Record<string, number>;
  trackerVersions?: string[];
}

export interface CartCommerceSignals {
  shippingPrice: number | null;
  shippingMethod: string | null;
  shippingLabel: string | null;
  shippingOptions: Array<{
    method: string | null;
    label: string | null;
    price: number | null;
    deliveryDays: number | null;
  }>;
  selectedDeliveryDays: number | null;
  maxItemDeliveryDays: number | null;
  maxHandlingDays: number | null;
  shippingCostRatio: number | null;
  paymentAttempts: number;
  lastRefuseReason: string | null;
  hadCoupon: boolean;
  hasUnavailableItem: boolean;
  hasRestockingItem: boolean;
  hasOnDemandItem: boolean;
  productSkus: string[];
}

export interface CartReasonCandidate {
  code: CartAbandonmentReasonCode;
  label: string;
  confidence: number;
  evidence: CartEvidence[];
}

export interface CartRecommendedAction {
  code: CartDecisionActionCode;
  label: string;
  channel: "whatsapp" | "email" | "none";
  delayMinutes: number;
  incentive: "none" | "existing_benefit" | "review_margin";
  rationale: string;
  guardrails: string[];
}

export interface CartIntelligenceDecision {
  modelVersion: string;
  mode: "shadow" | "pilot" | "active";
  reason: CartReasonCandidate;
  alternatives: CartReasonCandidate[];
  action: CartRecommendedAction;
  customer: CartCustomerProfile;
  checkout: CheckoutJourneySignal;
  commerce: CartCommerceSignals;
}

export interface CartIntelligenceInput {
  status: string;
  cartTotal: number | null;
  hasPhone: boolean;
  rawPayload: Record<string, unknown> | null;
  normalizedItems: Array<Partial<NormalizedCartItem> & Record<string, unknown>>;
  hubOnDemandSkus: Set<string>;
  customer: CartCustomerProfile;
  checkout: CheckoutJourneySignal;
  freeShippingThreshold?: number;
  mode?: "shadow" | "pilot" | "active";
}

const MODEL_VERSION = "rules-2026-07-09.2";
const DEFAULT_FREE_SHIPPING_THRESHOLD = 299;

const REASON_LABELS: Record<CartAbandonmentReasonCode, string> = {
  payment_failed: "Falha no pagamento",
  shipping_unavailable: "Frete indisponível",
  shipping_cost: "Custo de frete",
  delivery_time: "Prazo de entrega",
  on_demand: "Produto sob demanda",
  stock_wait: "Produção ou reposição",
  coupon_friction: "Cupom ou benefício",
  form_friction: "Fricção no cadastro",
  payment_choice: "Decisão de pagamento",
  shipping_choice: "Decisão de entrega",
  low_intent: "Intenção ainda baixa",
  unknown: "Motivo ainda indefinido",
};

export function buildCartCustomerProfile(input: {
  priorOrders: number;
  priorRevenue: number;
  priorCouponOrders: number;
}): CartCustomerProfile {
  const priorOrders = Math.max(0, input.priorOrders || 0);
  const priorRevenue = Math.max(0, input.priorRevenue || 0);
  const priorCouponOrders = Math.max(0, input.priorCouponOrders || 0);
  const couponRate = priorOrders > 0 ? priorCouponOrders / priorOrders : 0;

  let lifecycle: CartCustomerLifecycle = "new";
  if (priorOrders >= 5 || priorRevenue >= 2000) lifecycle = "vip";
  else if (priorOrders >= 3) lifecycle = "loyal";
  else if (priorOrders >= 1) lifecycle = "returning";

  let couponSensitivity: CartCustomerProfile["couponSensitivity"] = "unknown";
  if (priorOrders > 0) {
    couponSensitivity =
      couponRate >= 0.6 ? "high" : couponRate >= 0.25 ? "medium" : "low";
  }

  return {
    lifecycle,
    priorOrders,
    priorRevenue,
    priorCouponOrders,
    couponSensitivity,
  };
}

export function extractCartCommerceSignals(input: {
  rawPayload: Record<string, unknown> | null;
  normalizedItems: Array<Partial<NormalizedCartItem> & Record<string, unknown>>;
  hubOnDemandSkus: Set<string>;
  cartTotal: number | null;
}): CartCommerceSignals {
  const raw = input.rawPayload || {};
  const rawItems = parseRawItems(raw.items);
  const items = rawItems.length > 0 ? rawItems : input.normalizedItems;
  const shippingOptions = arrayValue(raw.shipping_methods).map((option) => ({
    method: stringOrNull(option.delivery_type) || stringOrNull(option.name),
    label: stringOrNull(option.label) || stringOrNull(option.name),
    price: numberOrNull(option.price),
    deliveryDays: numberOrNull(option.delivery_days),
  }));
  const shippingMethod =
    stringOrNull(raw.shipping_method) || stringOrNull(raw.delivery_type);
  const selectedOption = shippingMethod
    ? shippingOptions.find((option) => option.method === shippingMethod) || null
    : null;
  const shippingPrice =
    numberOrNull(raw.shipping_price) ?? selectedOption?.price ?? null;
  const productSkus = unique(
    items
      .map((item) => stringOrNull(item.variant_sku) || stringOrNull(item.sku))
      .filter((value): value is string => Boolean(value)),
  );
  const itemDeliveryDays = items
    .map((item) => numberOrNull(item.delivery_days))
    .filter((value): value is number => value != null);
  const itemHandlingDays = items
    .map(
      (item) =>
        numberOrNull(item.variant_handling_days) ??
        numberOrNull(item.handling_days) ??
        numberOrNull(item.restocking_days),
    )
    .filter((value): value is number => value != null);
  const hasUnavailableItem = items.some(
    (item) =>
      item.available === false || numberOrNull(item.available_quantity) === 0,
  );
  const hasRestockingItem = items.some((item) => {
    const unavailable =
      item.available === false || numberOrNull(item.available_quantity) === 0;
    const restocking =
      item.restocking_active === true ||
      item.variant_restocking_enabled === true ||
      (numberOrNull(item.variant_restocking_days) || 0) > 0 ||
      (numberOrNull(item.restocking_days) || 0) > 0;
    return unavailable && restocking;
  });
  const hasOnDemandItem = productSkus.some((sku) =>
    input.hubOnDemandSkus.has(sku),
  );
  const cartTotal = Math.max(0, Number(input.cartTotal || 0));

  return {
    shippingPrice,
    shippingMethod,
    shippingLabel:
      stringOrNull(raw.shipping_label) || selectedOption?.label || null,
    shippingOptions,
    selectedDeliveryDays: selectedOption?.deliveryDays ?? null,
    maxItemDeliveryDays: maxOrNull(itemDeliveryDays),
    maxHandlingDays:
      maxOrNull(
        [numberOrNull(raw.handling_days), ...itemHandlingDays].filter(isNumber),
      ) ?? null,
    shippingCostRatio:
      shippingPrice != null && cartTotal > 0
        ? Number((shippingPrice / cartTotal).toFixed(3))
        : null,
    paymentAttempts:
      numberOrNull(raw.payment_attempts_count) ??
      arrayValue(raw.payment_attempts).length,
    lastRefuseReason: stringOrNull(raw.last_refuse_reason),
    hadCoupon:
      Boolean(stringOrNull(raw.coupon_code)) ||
      unknownArray(raw.coupon_codes).some((coupon) =>
        Boolean(String(coupon || "").trim()),
      ),
    hasUnavailableItem,
    hasRestockingItem,
    hasOnDemandItem,
    productSkus,
  };
}

export function evaluateCartIntelligence(
  input: CartIntelligenceInput,
): CartIntelligenceDecision {
  const commerce = extractCartCommerceSignals(input);
  const candidates: CartReasonCandidate[] = [];
  const checkoutErrors = new Set(Object.keys(input.checkout.errorCodes || {}));
  const fieldErrors = Object.keys(input.checkout.fieldsErrored || {});
  const trustedCheckoutErrors = (input.checkout.trackerVersions || []).some(
    (version) => version >= "2026-07-09.2",
  );
  const lastStep = input.checkout.lastStep || "unknown";
  const lastField = input.checkout.lastFieldKey;

  const add = (
    code: CartAbandonmentReasonCode,
    confidence: number,
    evidence: CartEvidence[],
  ) => {
    candidates.push({
      code,
      label: REASON_LABELS[code],
      confidence: clampConfidence(confidence),
      evidence,
    });
  };

  if (
    trustedCheckoutErrors &&
    checkoutErrors.has("shipping_unavailable") &&
    lastStep === "shipping" &&
    !input.checkout.shippingMethod
  ) {
    add("shipping_unavailable", 0.84, [
      evidence(
        "shipping_error",
        "Checkout",
        "Sem modalidade concluída",
        "strong",
      ),
      evidence("last_step", "Última etapa", "Entrega", "supporting"),
    ]);
  }

  if (
    commerce.lastRefuseReason ||
    (trustedCheckoutErrors && checkoutErrors.has("payment_failed"))
  ) {
    const evidenceList: CartEvidence[] = [];
    if (commerce.lastRefuseReason) {
      evidenceList.push(
        evidence(
          "refusal",
          "Pagamento",
          "Recusa informada pela VNDA",
          "strong",
        ),
      );
    }
    if (checkoutErrors.has("payment_failed")) {
      evidenceList.push(
        evidence(
          "payment_error",
          "Checkout",
          "Erro de pagamento detectado",
          "strong",
        ),
      );
    }
    if (commerce.paymentAttempts > 0) {
      evidenceList.push(
        evidence(
          "payment_attempts",
          "Tentativas",
          String(commerce.paymentAttempts),
          "supporting",
        ),
      );
    }
    add("payment_failed", commerce.lastRefuseReason ? 0.97 : 0.9, evidenceList);
  }

  const trustedCouponError =
    trustedCheckoutErrors && checkoutErrors.has("invalid_coupon");
  if (trustedCouponError || lastField === "coupon") {
    add("coupon_friction", trustedCouponError ? 0.92 : 0.55, [
      evidence(
        "coupon",
        "Cupom",
        trustedCouponError ? "Cupom inválido" : "Último campo acessado",
        trustedCouponError ? "strong" : "supporting",
      ),
    ]);
  }

  const addressFields = new Set([
    "email",
    "phone",
    "document",
    "name",
    "last_name",
    "shipping_zip",
    "shipping_address",
    "address_number",
    "address_complement",
    "neighborhood",
    "city",
    "state",
  ]);
  const formErrorFields = trustedCheckoutErrors
    ? fieldErrors.filter((field) => addressFields.has(field))
    : [];
  if (
    formErrorFields.length > 0 ||
    (lastField && addressFields.has(lastField))
  ) {
    add("form_friction", formErrorFields.length > 0 ? 0.86 : 0.7, [
      evidence(
        "form_fields",
        "Cadastro",
        formErrorFields.length > 0
          ? `${formErrorFields.length} campo(s) com validação`
          : `Parou em ${humanizeToken(lastField || "cadastro")}`,
        formErrorFields.length > 0 ? "strong" : "supporting",
      ),
    ]);
  }

  const expensiveShipping =
    commerce.shippingPrice != null &&
    commerce.shippingPrice > 0 &&
    (commerce.shippingPrice >= 30 || (commerce.shippingCostRatio || 0) >= 0.15);
  if (expensiveShipping) {
    add("shipping_cost", lastStep === "shipping" ? 0.88 : 0.7, [
      evidence(
        "shipping_price",
        "Frete",
        formatBrl(commerce.shippingPrice || 0),
        "strong",
      ),
      ...(commerce.shippingCostRatio != null
        ? [
            evidence(
              "shipping_ratio",
              "Peso no carrinho",
              `${Math.round(commerce.shippingCostRatio * 100)}%`,
              "supporting" as const,
            ),
          ]
        : []),
    ]);
  }

  const deliveryDays = Math.max(
    commerce.selectedDeliveryDays || 0,
    commerce.maxItemDeliveryDays || 0,
    commerce.maxHandlingDays || 0,
  );
  if (commerce.hasOnDemandItem) {
    add("on_demand", 0.9, [
      evidence("on_demand", "Produto", "Marcado como sob demanda", "strong"),
      ...(deliveryDays > 0
        ? [
            evidence(
              "delivery_days",
              "Prazo",
              `${deliveryDays} dias`,
              "supporting" as const,
            ),
          ]
        : []),
    ]);
  }

  if (commerce.hasRestockingItem) {
    add("stock_wait", 0.8, [
      evidence(
        "restocking",
        "Estoque",
        "Item indisponível com reposição",
        "strong",
      ),
      ...(deliveryDays > 0
        ? [
            evidence(
              "delivery_days",
              "Prazo",
              `${deliveryDays} dias`,
              "supporting" as const,
            ),
          ]
        : []),
    ]);
  }

  if (deliveryDays >= 12) {
    add("delivery_time", lastStep === "shipping" ? 0.86 : 0.72, [
      evidence(
        "delivery_days",
        "Prazo estimado",
        `${deliveryDays} dias`,
        "strong",
      ),
      ...(commerce.shippingLabel
        ? [
            evidence(
              "shipping_method",
              "Modalidade",
              commerce.shippingLabel,
              "context" as const,
            ),
          ]
        : []),
    ]);
  }

  if (lastStep === "payment") {
    const trustedCardValidation =
      trustedCheckoutErrors && checkoutErrors.has("invalid_card");
    add(
      "payment_choice",
      trustedCardValidation ? 0.82 : commerce.paymentAttempts > 0 ? 0.74 : 0.68,
      [
        evidence(
          "last_step",
          "Última etapa",
          "Pagamento",
          input.checkout.linked ? "supporting" : "context",
        ),
        ...(input.checkout.paymentMethod
          ? [
              evidence(
                "payment_method",
                "Método",
                humanizeToken(input.checkout.paymentMethod),
                "context" as const,
              ),
            ]
          : []),
        ...(commerce.paymentAttempts > 0
          ? [
              evidence(
                "payment_attempts",
                "Tentativas",
                String(commerce.paymentAttempts),
                "supporting" as const,
              ),
            ]
          : []),
        ...(trustedCardValidation
          ? [
              evidence(
                "card_validation",
                "Cartão",
                "Dados pediram correção antes da tentativa",
                "strong" as const,
              ),
            ]
          : []),
      ],
    );
  } else if (lastStep === "shipping") {
    add("shipping_choice", 0.64, [
      evidence("last_step", "Última etapa", "Entrega", "supporting"),
    ]);
  }

  if (!input.checkout.linked || lastStep === "cart" || lastStep === "unknown") {
    add("low_intent", input.checkout.linked ? 0.5 : 0.38, [
      evidence(
        "checkout_depth",
        "Profundidade",
        input.checkout.linked
          ? "Não avançou no checkout"
          : "Sessão ainda não conectada",
        "context",
      ),
    ]);
  }

  add("unknown", 0.25, [
    evidence("fallback", "Leitura", "Sem evidência conclusiva", "context"),
  ]);

  candidates.sort((a, b) => b.confidence - a.confidence);
  const reason = candidates[0];
  const action = recommendAction({
    status: input.status,
    reason,
    customer: input.customer,
    commerce,
    hasPhone: input.hasPhone,
    cartTotal: input.cartTotal,
    freeShippingThreshold:
      input.freeShippingThreshold || DEFAULT_FREE_SHIPPING_THRESHOLD,
  });

  return {
    modelVersion: MODEL_VERSION,
    mode: input.mode || "shadow",
    reason,
    alternatives: candidates.slice(1, 4),
    action,
    customer: input.customer,
    checkout: input.checkout,
    commerce,
  };
}

function recommendAction(input: {
  status: string;
  reason: CartReasonCandidate;
  customer: CartCustomerProfile;
  commerce: CartCommerceSignals;
  hasPhone: boolean;
  cartTotal: number | null;
  freeShippingThreshold: number;
}): CartRecommendedAction {
  if (input.status === "recovered" || input.status === "closed") {
    return {
      code: "cancel_recovery",
      label: "Encerrar contatos",
      channel: "none",
      delayMinutes: 0,
      incentive: "none",
      rationale: "O carrinho já foi encerrado ou convertido.",
      guardrails: ["Cancelar qualquer mensagem ainda na fila"],
    };
  }

  const channel = input.hasPhone ? "whatsapp" : "email";
  const recurringGuardrail =
    input.customer.lifecycle === "new"
      ? "Reforçar confiança, troca e suporte de tamanho"
      : "Não tratar como primeira compra";

  const baseGuardrails = [
    "Cancelar imediatamente se houver compra",
    "Respeitar exclusão e limite de frequência",
    recurringGuardrail,
  ];

  switch (input.reason.code) {
    case "payment_failed":
      return action(
        "resume_payment",
        "Ajudar a concluir o pagamento",
        channel,
        10,
        "Retomar exatamente no pagamento e mostrar uma alternativa válida, sem desconto automático.",
        baseGuardrails,
      );
    case "shipping_unavailable":
    case "shipping_cost": {
      const total = Math.max(0, Number(input.cartTotal || 0));
      const gap = Math.max(0, input.freeShippingThreshold - total);
      const rationale =
        gap > 0 && gap <= 60
          ? `Mostrar as opções de entrega e informar que faltam ${formatBrl(gap)} para o benefício vigente.`
          : "Mostrar preço, prazo e alternativa de entrega sem prometer frete grátis indevido.";
      return action(
        "show_shipping_options",
        "Resolver a objeção de frete",
        channel,
        20,
        rationale,
        [
          ...baseGuardrails,
          "Usar a regra de frete vigente como fonte da verdade",
        ],
        "existing_benefit",
      );
    }
    case "delivery_time":
    case "on_demand":
    case "stock_wait":
      return action(
        "explain_delivery_and_alternatives",
        "Explicar prazo e oferecer pronta entrega",
        channel,
        30,
        "Informar a previsão real e recomendar equivalentes disponíveis quando o produto depender de produção ou reposição.",
        [...baseGuardrails, "Nunca encurtar prazo na copy"],
        "none",
      );
    case "coupon_friction":
      return action(
        "resolve_coupon",
        "Corrigir o benefício aplicado",
        channel,
        15,
        "Explicar qual promoção está realmente válida e devolver o cliente ao carrinho já conferido.",
        [
          ...baseGuardrails,
          "Não criar cupom novo antes de validar a promoção atual",
        ],
        "existing_benefit",
      );
    case "form_friction":
      return action(
        "reduce_checkout_friction",
        "Retomar sem repetir o cadastro",
        channel,
        20,
        "Levar de volta ao checkout preservando o carrinho e oferecer ajuda no campo que gerou fricção.",
        baseGuardrails,
      );
    case "payment_choice":
    case "shipping_choice":
      return action(
        "resume_checkout",
        "Retomar na última decisão",
        channel,
        30,
        "Relembrar o carrinho e destacar apenas as opções já disponíveis no checkout.",
        baseGuardrails,
      );
    case "low_intent":
      return action(
        "wait_and_observe",
        "Aguardar antes de pressionar",
        input.hasPhone ? "email" : "email",
        360,
        "Há pouca evidência de intenção de compra; priorizar um lembrete leve e tardio.",
        [...baseGuardrails, "Não oferecer desconto no primeiro contato"],
      );
    default:
      return action(
        "gentle_reminder",
        "Enviar lembrete neutro",
        channel,
        30,
        "O motivo ainda não é confiável; usar uma mensagem que não inventa a objeção do cliente.",
        [...baseGuardrails, "Não mencionar motivo específico"],
      );
  }
}

function action(
  code: CartDecisionActionCode,
  label: string,
  channel: "whatsapp" | "email",
  delayMinutes: number,
  rationale: string,
  guardrails: string[],
  incentive: CartRecommendedAction["incentive"] = "none",
): CartRecommendedAction {
  return {
    code,
    label,
    channel,
    delayMinutes,
    incentive,
    rationale,
    guardrails,
  };
}

function evidence(
  key: string,
  label: string,
  value: string,
  strength: CartEvidence["strength"],
): CartEvidence {
  return { key, label, value, strength };
}

function parseRawItems(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isNumber(value: number | null): value is number {
  return value != null && Number.isFinite(value);
}

function maxOrNull(values: number[]): number | null {
  return values.length > 0 ? Math.max(...values) : null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function clampConfidence(value: number): number {
  return Number(Math.max(0, Math.min(0.99, value)).toFixed(2));
}

function formatBrl(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function humanizeToken(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

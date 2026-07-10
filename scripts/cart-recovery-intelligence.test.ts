import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCartCustomerProfile,
  evaluateCartIntelligence,
  extractCartCommerceSignals,
  type CartIntelligenceInput,
  type CheckoutJourneySignal,
} from "../src/lib/cart-recovery/intelligence.ts";
import {
  buildFreeShippingMessage,
  freeShippingThresholdForRegion,
} from "../src/lib/cart-recovery/location.ts";

const emptyCheckout: CheckoutJourneySignal = {
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
  trackerVersions: ["2026-07-09.2"],
};

function input(
  patch: Partial<CartIntelligenceInput> = {},
): CartIntelligenceInput {
  return {
    status: "open",
    cartTotal: 180,
    hasPhone: true,
    rawPayload: {},
    normalizedItems: [],
    hubOnDemandSkus: new Set<string>(),
    customer: buildCartCustomerProfile({
      priorOrders: 0,
      priorRevenue: 0,
      priorCouponOrders: 0,
    }),
    checkout: emptyCheckout,
    freeShippingThreshold: 299,
    mode: "shadow",
    ...patch,
  };
}

test("classifica recorrência e sensibilidade a cupom pelo histórico anterior", () => {
  const profile = buildCartCustomerProfile({
    priorOrders: 4,
    priorRevenue: 1500,
    priorCouponOrders: 3,
  });
  assert.equal(profile.lifecycle, "loyal");
  assert.equal(profile.couponSensitivity, "high");
});

test("falha de pagamento tem prioridade e não oferece desconto automático", () => {
  const decision = evaluateCartIntelligence(
    input({
      rawPayload: {
        payment_attempts_count: 2,
        last_refuse_reason: "card_declined",
      },
      checkout: {
        ...emptyCheckout,
        linked: true,
        sessionId: "checkout-1",
        lastStep: "payment",
        errorCodes: { payment_failed: 1 },
      },
    }),
  );
  assert.equal(decision.reason.code, "payment_failed");
  assert.equal(decision.action.code, "resume_payment");
  assert.equal(decision.action.incentive, "none");
  assert.ok(decision.reason.confidence >= 0.9);
});

test("tentativa sem recusa não é chamada de falha de pagamento", () => {
  const decision = evaluateCartIntelligence(
    input({
      rawPayload: { payment_attempts_count: 1 },
      checkout: {
        ...emptyCheckout,
        linked: true,
        sessionId: "checkout-payment-choice",
        lastStep: "payment",
        paymentMethod: "credit_card",
      },
    }),
  );
  assert.equal(decision.reason.code, "payment_choice");
  assert.notEqual(decision.reason.code, "payment_failed");
});

test("erro legado do pixel não é tratado como recusa confirmada", () => {
  const decision = evaluateCartIntelligence(
    input({
      checkout: {
        ...emptyCheckout,
        linked: true,
        sessionId: "checkout-legado",
        lastStep: "payment",
        errorCodes: { invalid_card: 1, payment_failed: 1 },
        trackerVersions: ["2026-06-28.1"],
      },
    }),
  );
  assert.equal(decision.reason.code, "payment_choice");
});

test("validação do cartão não é chamada de pagamento recusado", () => {
  const decision = evaluateCartIntelligence(
    input({
      checkout: {
        ...emptyCheckout,
        linked: true,
        sessionId: "checkout-card-validation",
        lastStep: "payment",
        lastFieldKey: "card_number",
        errorCodes: { invalid_card: 1 },
      },
    }),
  );
  assert.equal(decision.reason.code, "payment_choice");
  assert.notEqual(decision.reason.code, "payment_failed");
});

test("frete caro usa preço e peso no carrinho como evidência", () => {
  const decision = evaluateCartIntelligence(
    input({
      cartTotal: 270,
      rawPayload: { shipping_price: 36, shipping_method: "sedex" },
      checkout: {
        ...emptyCheckout,
        linked: true,
        sessionId: "checkout-2",
        lastStep: "shipping",
      },
    }),
  );
  assert.equal(decision.reason.code, "shipping_cost");
  assert.equal(decision.action.code, "show_shipping_options");
  assert.match(decision.action.rationale, /faltam R\$\s?29,00/i);
});

test("produto sob demanda gera explicação de prazo e alternativa pronta", () => {
  const decision = evaluateCartIntelligence(
    input({
      normalizedItems: [{ sku: "SKU-SOB-DEMANDA", handling_days: 15 }],
      hubOnDemandSkus: new Set(["SKU-SOB-DEMANDA"]),
    }),
  );
  assert.equal(decision.reason.code, "on_demand");
  assert.equal(decision.action.code, "explain_delivery_and_alternatives");
});

test("reposição configurada não vira motivo quando o item ainda está disponível", () => {
  const decision = evaluateCartIntelligence(
    input({
      normalizedItems: [
        {
          sku: "SKU-DISPONIVEL",
          available: true,
          available_quantity: 12,
          restocking_active: true,
          restocking_days: 10,
        },
      ],
    }),
  );
  assert.notEqual(decision.reason.code, "stock_wait");
  assert.notEqual(decision.reason.code, "on_demand");
});

test("validação de endereço é tratada como fricção, não erro técnico genérico", () => {
  const decision = evaluateCartIntelligence(
    input({
      checkout: {
        ...emptyCheckout,
        linked: true,
        sessionId: "checkout-3",
        lastStep: "identification",
        lastFieldKey: "shipping_zip",
        fieldsErrored: { shipping_zip: 2 },
      },
    }),
  );
  assert.equal(decision.reason.code, "form_friction");
  assert.equal(decision.action.code, "reduce_checkout_friction");
});

test("baixa evidência espera e evita pressão comercial precoce", () => {
  const decision = evaluateCartIntelligence(input());
  assert.equal(decision.reason.code, "low_intent");
  assert.equal(decision.action.code, "wait_and_observe");
  assert.equal(decision.action.channel, "email");
});

test("carrinho recuperado sempre encerra os contatos", () => {
  const decision = evaluateCartIntelligence(input({ status: "recovered" }));
  assert.equal(decision.action.code, "cancel_recovery");
  assert.equal(decision.action.channel, "none");
});

test("cupom em array da VNDA é preservado como sinal comercial", () => {
  const commerce = extractCartCommerceSignals({
    rawPayload: { coupon_codes: ["VOLTE10"] },
    normalizedItems: [],
    hubOnDemandSkus: new Set(),
    cartTotal: 100,
  });
  assert.equal(commerce.hadCoupon, true);
});

test("política de frete usa o limite real de cada região", () => {
  assert.equal(freeShippingThresholdForRegion("SP"), 299);
  assert.equal(freeShippingThresholdForRegion("BA"), 345);
  assert.match(
    buildFreeShippingMessage({ state: "BA", cartTotal: 200 }),
    /R\$\s?345,00/,
  );
});

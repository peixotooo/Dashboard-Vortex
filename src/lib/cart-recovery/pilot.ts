import type { CartIntelligenceDecision } from "./intelligence";

export const CART_RECOVERY_EXPERIMENT_KEY_PREFIX = "cart-intelligence-pilot";
export const CART_RECOVERY_PILOT_MIN_CONFIDENCE = 0.7;
export const CART_RECOVERY_PILOT_MATURITY_HOURS = 96;
export const CART_RECOVERY_PILOT_MIN_SAMPLE = 100;

export type PilotCohort = "control" | "pilot" | "baseline";

export function cartRecoveryExperimentKey(version: number) {
  return `${CART_RECOVERY_EXPERIMENT_KEY_PREFIX}-v${Math.max(
    1,
    Math.round(Number(version) || 1),
  )}`;
}

export type PilotEligibilityInput = {
  mode: "shadow" | "pilot" | "active";
  ruleEnabled: boolean;
  rolloutPercentage: number;
  holdoutPercentage: number;
  pilotStartedAt: string | null;
  cartId: string;
  assignmentKey?: string;
  cartStatus: string;
  cartStartedAt: string;
  hasPhone: boolean;
  step: {
    whatsapp_enabled: boolean;
    email_enabled: boolean;
  } | null;
  decision: CartIntelligenceDecision;
};

export type PilotEligibility = {
  eligible: boolean;
  reason: string;
  cohort: PilotCohort;
  channel: "whatsapp" | "email" | null;
  scheduledAt: string | null;
};

export function stableExperimentBucket(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 100;
}

export function cartRecoveryPilotCohort(input: {
  cartId: string;
  holdoutPercentage: number;
  rolloutPercentage: number;
}): PilotCohort {
  const holdout = clampPercentage(input.holdoutPercentage, 0, 50);
  const rollout = clampPercentage(
    input.rolloutPercentage,
    0,
    Math.max(0, 100 - holdout),
  );
  const bucket = stableExperimentBucket(input.cartId);
  if (bucket < holdout) return "control";
  if (bucket < holdout + rollout) return "pilot";
  return "baseline";
}

export function evaluatePilotEligibility(
  input: PilotEligibilityInput,
): PilotEligibility {
  const cohort = cartRecoveryPilotCohort({
    cartId: input.assignmentKey || input.cartId,
    holdoutPercentage: input.holdoutPercentage,
    rolloutPercentage: input.rolloutPercentage,
  });
  const rejected = (reason: string): PilotEligibility => ({
    eligible: false,
    reason,
    cohort,
    channel: null,
    scheduledAt: null,
  });

  if (!input.ruleEnabled) return rejected("rule_disabled");
  if (input.mode !== "pilot" && input.mode !== "active") {
    return rejected("shadow_mode");
  }
  if (input.rolloutPercentage <= 0) return rejected("rollout_disabled");
  if (input.cartStatus !== "open") return rejected("cart_not_open");
  if (!input.step) return rejected("missing_first_step");
  if (!input.pilotStartedAt) return rejected("missing_pilot_start");

  const cartStartedAt = new Date(input.cartStartedAt).getTime();
  const pilotStartedAt = new Date(input.pilotStartedAt).getTime();
  if (!Number.isFinite(cartStartedAt) || !Number.isFinite(pilotStartedAt)) {
    return rejected("invalid_start_time");
  }
  if (cartStartedAt < pilotStartedAt) return rejected("before_pilot_start");

  const decision = input.decision;
  if (!decision.checkout.linked) return rejected("checkout_not_linked");
  if (decision.reason.confidence < CART_RECOVERY_PILOT_MIN_CONFIDENCE) {
    return rejected("low_confidence");
  }
  if (
    decision.action.code === "cancel_recovery" ||
    decision.action.code === "wait_and_observe" ||
    decision.action.channel === "none"
  ) {
    return rejected("non_actionable_decision");
  }

  const channel = choosePilotChannel({
    preferred: decision.action.channel,
    hasPhone: input.hasPhone,
    whatsappEnabled: input.step.whatsapp_enabled,
    emailEnabled: input.step.email_enabled,
  });
  if (!channel) return rejected("no_available_channel");

  const scheduledAt = new Date(
    cartStartedAt + Math.max(0, decision.action.delayMinutes) * 60_000,
  ).toISOString();

  return {
    eligible: true,
    reason: "eligible",
    cohort,
    channel,
    scheduledAt,
  };
}

export function pilotQueueBlocksLegacy(status: string): boolean {
  return status === "scheduled" || status === "processing" || status === "sent";
}

export type ExperimentGroupStats = {
  sample: number;
  recovered: number;
  recoveredValue: number;
};

export function compareRecoveryGroups(input: {
  pilot: ExperimentGroupStats;
  control: ExperimentGroupStats;
}) {
  const pilotRate = safeRate(input.pilot.recovered, input.pilot.sample);
  const controlRate = safeRate(input.control.recovered, input.control.sample);
  const upliftPoints = (pilotRate - controlRate) * 100;
  const relativeUplift =
    controlRate > 0 ? (pilotRate - controlRate) / controlRate : null;
  const pilotRevenuePerCart = safeDivide(
    input.pilot.recoveredValue,
    input.pilot.sample,
  );
  const controlRevenuePerCart = safeDivide(
    input.control.recoveredValue,
    input.control.sample,
  );
  const revenuePerCartLift = pilotRevenuePerCart - controlRevenuePerCart;
  const significance = twoProportionZTest({
    successA: input.pilot.recovered,
    sampleA: input.pilot.sample,
    successB: input.control.recovered,
    sampleB: input.control.sample,
  });
  const sampleReady =
    input.pilot.sample >= CART_RECOVERY_PILOT_MIN_SAMPLE &&
    input.control.sample >= CART_RECOVERY_PILOT_MIN_SAMPLE;

  let verdict: "collecting" | "winner" | "loser" | "inconclusive" =
    "collecting";
  if (sampleReady) {
    if (significance.pValue < 0.05 && upliftPoints > 0) verdict = "winner";
    else if (significance.pValue < 0.05 && upliftPoints < 0) verdict = "loser";
    else verdict = "inconclusive";
  }

  return {
    pilotRate,
    controlRate,
    upliftPoints,
    relativeUplift,
    pilotRevenuePerCart,
    controlRevenuePerCart,
    revenuePerCartLift,
    pValue: significance.pValue,
    confidence: significance.confidence,
    sampleReady,
    verdict,
  };
}

function choosePilotChannel(input: {
  preferred: "whatsapp" | "email" | "none";
  hasPhone: boolean;
  whatsappEnabled: boolean;
  emailEnabled: boolean;
}): "whatsapp" | "email" | null {
  const whatsappAvailable = input.hasPhone && input.whatsappEnabled;
  if (input.preferred === "whatsapp" && whatsappAvailable) return "whatsapp";
  if (input.preferred === "email" && input.emailEnabled) return "email";
  if (input.emailEnabled) return "email";
  if (whatsappAvailable) return "whatsapp";
  return null;
}

function twoProportionZTest(input: {
  successA: number;
  sampleA: number;
  successB: number;
  sampleB: number;
}) {
  if (input.sampleA <= 0 || input.sampleB <= 0) {
    return { pValue: 1, confidence: 0 };
  }
  const rateA = input.successA / input.sampleA;
  const rateB = input.successB / input.sampleB;
  const pooled =
    (input.successA + input.successB) / (input.sampleA + input.sampleB);
  const standardError = Math.sqrt(
    pooled * (1 - pooled) * (1 / input.sampleA + 1 / input.sampleB),
  );
  if (!Number.isFinite(standardError) || standardError === 0) {
    return { pValue: 1, confidence: 0 };
  }
  const z = Math.abs((rateA - rateB) / standardError);
  const pValue = Math.max(0, Math.min(1, 2 * (1 - normalCdf(z))));
  return { pValue, confidence: 1 - pValue };
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.sqrt(2)));
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const approximation =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return sign * approximation;
}

function safeRate(value: number, total: number): number {
  return total > 0 ? value / total : 0;
}

function safeDivide(value: number, total: number): number {
  return total > 0 ? value / total : 0;
}

function clampPercentage(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

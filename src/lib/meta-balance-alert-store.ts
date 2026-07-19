import { randomUUID } from "node:crypto";
import {
  metaBalanceLevelRank,
  type MetaBalanceAlertLevel,
} from "@/lib/meta-balance-alert";
import { createAdminClient } from "@/lib/supabase-admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface MetaBalanceAlertClaim {
  shouldSend: boolean;
  token: string | null;
  previousLevel: MetaBalanceAlertLevel;
  recharged: boolean;
  decision: string;
  backend: "rpc" | "legacy";
  accountId: string;
}

export interface ClaimMetaBalanceAlertInput {
  accountId: string;
  accountName: string;
  workspaceId: string;
  availableBrl: number;
  dailyBurnBrl: number;
  runwayHours: number | null;
  observedLevel: MetaBalanceAlertLevel;
  rechargeMarginBrl: number;
  claimTtlSeconds: number;
}

interface LegacyState {
  last_available: number | string | null;
  last_alert_level: string | null;
  last_alert_at: string | null;
  updated_at: string | null;
}

interface RpcClaim {
  should_send: boolean;
  alert_claim_token: string | null;
  previous_alert_level: MetaBalanceAlertLevel;
  recharged: boolean;
  decision: string;
}

const LEGACY_CLAIM_PREFIX = "claim:";

function isMissingRpc(error: { code?: string; message?: string } | null): boolean {
  return Boolean(
    error &&
      (error.code === "PGRST202" ||
        error.message?.includes("Could not find the function")),
  );
}

function normalizeLevel(level: string | null | undefined): MetaBalanceAlertLevel {
  return level === "warn" || level === "critical" ? level : "ok";
}

function parseLegacyClaim(value: string | null | undefined): {
  observedLevel: MetaBalanceAlertLevel;
  previousLevel: MetaBalanceAlertLevel;
} | null {
  if (!value?.startsWith(LEGACY_CLAIM_PREFIX)) return null;
  const [, observedLevel, previousLevel] = value.split(":");
  if (observedLevel !== "warn" && observedLevel !== "critical") return null;
  return {
    observedLevel,
    previousLevel: normalizeLevel(previousLevel),
  };
}

async function loadLegacyState(
  admin: AdminClient,
  accountId: string,
): Promise<LegacyState | null> {
  const { data, error } = await admin
    .from("meta_balance_alerts")
    .select("last_available, last_alert_level, last_alert_at, updated_at")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw new Error(`Could not load alert state: ${error.message}`);
  return data as LegacyState | null;
}

async function saveLegacyObservation(
  admin: AdminClient,
  input: ClaimMetaBalanceAlertInput,
  level: MetaBalanceAlertLevel,
): Promise<void> {
  const { error } = await admin.from("meta_balance_alerts").upsert(
    {
      account_id: input.accountId,
      account_name: input.accountName,
      last_available: input.availableBrl,
      last_alert_level: level,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "account_id" },
  );
  if (error) throw new Error(`Could not persist alert state: ${error.message}`);
}

async function claimLegacy(
  admin: AdminClient,
  input: ClaimMetaBalanceAlertInput,
  attempt = 0,
): Promise<MetaBalanceAlertClaim> {
  const state = await loadLegacyState(admin, input.accountId);
  const pending = parseLegacyClaim(state?.last_alert_level);
  const updatedAtMs = state?.updated_at ? Date.parse(state.updated_at) : Number.NaN;
  const claimIsActive =
    Boolean(pending) &&
    Number.isFinite(updatedAtMs) &&
    Date.now() - updatedAtMs < input.claimTtlSeconds * 1000;
  const previousLevel = pending
    ? pending.previousLevel
    : normalizeLevel(state?.last_alert_level);
  const lastAvailable =
    state?.last_available == null ? null : Number(state.last_available);
  const recharged =
    lastAvailable != null &&
    Number.isFinite(lastAvailable) &&
    input.availableBrl > lastAvailable + Math.max(0, input.rechargeMarginBrl);

  if (input.observedLevel === "ok" || recharged) {
    await saveLegacyObservation(admin, input, "ok");
    return {
      shouldSend: false,
      token: null,
      previousLevel: "ok",
      recharged,
      decision: recharged ? "recharged" : "healthy",
      backend: "legacy",
      accountId: input.accountId,
    };
  }

  if (claimIsActive) {
    return {
      shouldSend: false,
      token: null,
      previousLevel,
      recharged: false,
      decision: "in_flight",
      backend: "legacy",
      accountId: input.accountId,
    };
  }

  if (
    metaBalanceLevelRank(input.observedLevel) <= metaBalanceLevelRank(previousLevel)
  ) {
    await saveLegacyObservation(admin, input, previousLevel);
    return {
      shouldSend: false,
      token: null,
      previousLevel,
      recharged: false,
      decision: "already_sent",
      backend: "legacy",
      accountId: input.accountId,
    };
  }

  const token = `${LEGACY_CLAIM_PREFIX}${input.observedLevel}:${previousLevel}:${randomUUID()}`;
  const now = new Date().toISOString();
  let claimed = false;

  if (!state) {
    const { error } = await admin.from("meta_balance_alerts").insert({
      account_id: input.accountId,
      account_name: input.accountName,
      last_available: input.availableBrl,
      last_alert_level: token,
      updated_at: now,
    });
    if (!error) claimed = true;
    else if (error.code !== "23505") {
      throw new Error(`Could not claim alert: ${error.message}`);
    }
  } else {
    let query = admin
      .from("meta_balance_alerts")
      .update({
        account_name: input.accountName,
        last_available: input.availableBrl,
        last_alert_level: token,
        updated_at: now,
      })
      .eq("account_id", input.accountId);
    query = state.updated_at
      ? query.eq("updated_at", state.updated_at)
      : query.is("updated_at", null);
    query = state.last_alert_level
      ? query.eq("last_alert_level", state.last_alert_level)
      : query.is("last_alert_level", null);

    const { data, error } = await query.select("account_id").maybeSingle();
    if (error) throw new Error(`Could not claim alert: ${error.message}`);
    claimed = Boolean(data);
  }

  if (!claimed) {
    if (attempt < 1) return claimLegacy(admin, input, attempt + 1);
    return {
      shouldSend: false,
      token: null,
      previousLevel,
      recharged: false,
      decision: "in_flight",
      backend: "legacy",
      accountId: input.accountId,
    };
  }

  return {
    shouldSend: true,
    token,
    previousLevel,
    recharged: false,
    decision: "claimed",
    backend: "legacy",
    accountId: input.accountId,
  };
}

export async function claimMetaBalanceAlert(
  admin: AdminClient,
  input: ClaimMetaBalanceAlertInput,
): Promise<MetaBalanceAlertClaim> {
  const { data, error } = await admin
    .rpc("claim_meta_balance_alert", {
      p_account_id: input.accountId,
      p_account_name: input.accountName,
      p_workspace_id: input.workspaceId,
      p_available: input.availableBrl,
      p_daily_burn: input.dailyBurnBrl,
      p_runway_hours: input.runwayHours,
      p_observed_level: input.observedLevel,
      p_recharge_margin: input.rechargeMarginBrl,
      p_claim_ttl_seconds: input.claimTtlSeconds,
    })
    .single();

  if (error) {
    if (isMissingRpc(error)) return claimLegacy(admin, input);
    throw new Error(`Could not claim alert: ${error.message}`);
  }

  const claim = data as RpcClaim;
  return {
    shouldSend: claim.should_send,
    token: claim.alert_claim_token,
    previousLevel: claim.previous_alert_level,
    recharged: claim.recharged,
    decision: claim.decision,
    backend: "rpc",
    accountId: input.accountId,
  };
}

export async function completeMetaBalanceAlertClaim(
  admin: AdminClient,
  claim: MetaBalanceAlertClaim,
  success: boolean,
  messageId: string | null,
  errorMessage: string | null,
): Promise<void> {
  if (!claim.token) throw new Error("Cannot complete an alert without a claim token");

  if (claim.backend === "legacy") {
    const { data, error } = await admin
      .from("meta_balance_alerts")
      .update({
        last_alert_level: success ? normalizeLevel(claim.token.split(":")[1]) : claim.previousLevel,
        last_alert_at: success ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("account_id", claim.accountId)
      .eq("last_alert_level", claim.token)
      .select("account_id")
      .maybeSingle();
    if (error) throw new Error(`Could not finalize alert: ${error.message}`);
    if (!data) throw new Error("Could not finalize alert: claim_not_found");
    return;
  }

  let lastError = "claim_not_found";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { data, error } = await admin.rpc("complete_meta_balance_alert", {
      p_account_id: claim.accountId,
      p_claim_token: claim.token,
      p_success: success,
      p_message_id: messageId,
      p_error: errorMessage,
    });
    if (!error && data === true) return;
    lastError = error?.message || "claim_not_found";
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  throw new Error(`Could not finalize Meta balance alert: ${lastError}`);
}

export async function recordMetaBalanceAlertCheckError(
  admin: AdminClient,
  input: {
    accountId: string;
    accountName: string;
    workspaceId: string;
    error: string;
  },
): Promise<void> {
  const { error } = await admin.rpc("record_meta_balance_alert_error", {
    p_account_id: input.accountId,
    p_account_name: input.accountName,
    p_workspace_id: input.workspaceId,
    p_error: input.error,
  });
  if (error && !isMissingRpc(error)) {
    throw new Error(`Could not persist check error: ${error.message}`);
  }
}

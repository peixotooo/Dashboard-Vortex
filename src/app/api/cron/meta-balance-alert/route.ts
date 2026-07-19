import { NextRequest, NextResponse } from "next/server";
import { resolveTokenForAccount } from "@/lib/api-auth";
import {
  buildMetaBalanceTemplateVariables,
  classifyMetaBalance,
  parseMetaBalanceThresholds,
} from "@/lib/meta-balance-alert";
import {
  claimMetaBalanceAlert,
  completeMetaBalanceAlertClaim,
  recordMetaBalanceAlertCheckError,
} from "@/lib/meta-balance-alert-store";
import { getAdAccountFunding, runWithToken } from "@/lib/meta-api";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWaConfig, sendTemplateMessage } from "@/lib/whatsapp-api";

export const maxDuration = 120;

type AdminClient = ReturnType<typeof createAdminClient>;

interface MonitoredAccount {
  id: string;
  fallbackLabel: string;
  fallbackTokenEnv?: string;
}

const DEFAULT_ACCOUNTS: MonitoredAccount[] = [
  {
    id: "act_1613880720305953",
    fallbackLabel: "BK BACKUP",
    fallbackTokenEnv: "META_DST_ACCESS_TOKEN",
  },
  {
    id: "act_1234583478774369",
    fallbackLabel: "B7984",
    fallbackTokenEnv: "META_SRC_TOKEN",
  },
];

const DEFAULT_PHONE = "5562985955001";
const DEFAULT_TEMPLATE = "meta_saldo_baixo";
const RECHARGE_MARGIN_BRL = 50;
const CLAIM_TTL_SECONDS = 15 * 60;
const MAX_MONITORED_ACCOUNTS = 10;

function canonicalAccountId(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

function getMonitoredAccounts(): MonitoredAccount[] {
  const configured = process.env.META_BALANCE_ALERT_ACCOUNT_IDS;
  if (!configured) return DEFAULT_ACCOUNTS;

  const ids = Array.from(
    new Set(
      configured
        .split(",")
        .map(canonicalAccountId)
        .filter((id) => /^act_\d+$/.test(id)),
    ),
  );
  if (ids.length === 0) {
    throw new Error("META_BALANCE_ALERT_ACCOUNT_IDS has no valid account IDs");
  }
  if (ids.length > MAX_MONITORED_ACCOUNTS) {
    throw new Error(
      `META_BALANCE_ALERT_ACCOUNT_IDS exceeds the ${MAX_MONITORED_ACCOUNTS}-account safety limit`,
    );
  }

  const defaults = new Map(DEFAULT_ACCOUNTS.map((account) => [account.id, account]));
  return ids.map(
    (id) =>
      defaults.get(id) || {
        id,
        fallbackLabel: id,
      },
  );
}

async function resolveWorkspaceAndNames(
  admin: AdminClient,
  accounts: MonitoredAccount[],
): Promise<{ workspaceId: string; names: Map<string, string> }> {
  const targetIds = new Set(accounts.map((account) => account.id));
  const accountVariants = Array.from(targetIds).flatMap((id) => [id, id.slice(4)]);
  const { data, error } = await admin
    .from("meta_accounts")
    .select("workspace_id, account_id, account_name")
    .in("account_id", accountVariants);

  if (error) throw new Error(`Could not load Meta accounts: ${error.message}`);

  const rows = (data || []).map((row) => ({
    workspaceId: String(row.workspace_id),
    accountId: canonicalAccountId(String(row.account_id)),
    accountName: row.account_name ? String(row.account_name) : null,
  }));
  const explicitWorkspace = process.env.META_BALANCE_ALERT_WORKSPACE_ID?.trim();

  const grouped = new Map<
    string,
    { ids: Set<string>; names: Map<string, string> }
  >();
  for (const row of rows) {
    if (!targetIds.has(row.accountId)) continue;
    const group = grouped.get(row.workspaceId) || {
      ids: new Set<string>(),
      names: new Map<string, string>(),
    };
    group.ids.add(row.accountId);
    if (row.accountName) group.names.set(row.accountId, row.accountName);
    grouped.set(row.workspaceId, group);
  }

  if (explicitWorkspace) {
    const group = grouped.get(explicitWorkspace);
    if (!group || group.ids.size !== targetIds.size) {
      throw new Error(
        "Configured Meta balance workspace does not contain every monitored account",
      );
    }
    return { workspaceId: explicitWorkspace, names: group.names };
  }

  const completeCandidates = Array.from(grouped.entries()).filter(
    ([, group]) => group.ids.size === targetIds.size,
  );
  if (completeCandidates.length === 0) {
    throw new Error("No workspace contains every monitored Meta account");
  }
  if (completeCandidates.length === 1) {
    const [workspaceId, group] = completeCandidates[0];
    return { workspaceId, names: group.names };
  }

  const candidateIds = completeCandidates.map(([workspaceId]) => workspaceId);
  const { data: waRows, error: waError } = await admin
    .from("wa_config")
    .select("workspace_id")
    .in("workspace_id", candidateIds);
  if (waError) throw new Error(`Could not resolve WhatsApp workspace: ${waError.message}`);

  const withWhatsApp = new Set((waRows || []).map((row) => String(row.workspace_id)));
  const eligible = completeCandidates.filter(([workspaceId]) =>
    withWhatsApp.has(workspaceId),
  );
  if (eligible.length !== 1) {
    throw new Error(
      "Meta balance workspace is ambiguous; configure META_BALANCE_ALERT_WORKSPACE_ID",
    );
  }

  const [workspaceId, group] = eligible[0];
  return { workspaceId, names: group.names };
}

async function recordCheckError(
  admin: AdminClient,
  account: MonitoredAccount,
  accountName: string,
  workspaceId: string,
  message: string,
): Promise<void> {
  try {
    await recordMetaBalanceAlertCheckError(admin, {
      accountId: account.id,
      accountName,
      workspaceId,
      error: message,
    });
  } catch (error) {
    console.error("[meta-balance-alert] Could not persist check error", {
      accountId: account.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checkedAt = new Date().toISOString();

  try {
    const thresholds = parseMetaBalanceThresholds(
      process.env.META_BALANCE_WARN_HOURS,
      process.env.META_BALANCE_CRIT_HOURS,
    );
    const phone = process.env.META_BALANCE_ALERT_PHONE || DEFAULT_PHONE;
    const template = process.env.META_BALANCE_ALERT_TEMPLATE || DEFAULT_TEMPLATE;
    const templateLanguage =
      process.env.META_BALANCE_ALERT_TEMPLATE_LANG || "pt_BR";
    const accounts = getMonitoredAccounts();
    const admin = createAdminClient();
    const { workspaceId, names } = await resolveWorkspaceAndNames(admin, accounts);
    const waConfig = await getWaConfig(workspaceId);
    if (!waConfig) {
      throw new Error("WhatsApp Cloud API is not configured for the alert workspace");
    }

    const results: Record<string, unknown>[] = [];
    let failed = 0;

    for (const account of accounts) {
      const accountName = names.get(account.id) || account.fallbackLabel;

      try {
        const databaseToken = await resolveTokenForAccount(workspaceId, account.id);
        const fallbackToken = account.fallbackTokenEnv
          ? process.env[account.fallbackTokenEnv]
          : undefined;
        const token = databaseToken || fallbackToken;
        if (!token) {
          throw new Error("No Meta token configured for this account");
        }

        const funding = await runWithToken(token, () =>
          getAdAccountFunding(account.id),
        );
        const level = classifyMetaBalance(funding.runwayHours, thresholds);
        const claim = await claimMetaBalanceAlert(admin, {
          accountId: account.id,
          accountName,
          workspaceId,
          availableBrl: funding.availableBrl,
          dailyBurnBrl: funding.dailyBurnBrl,
          runwayHours: Number.isFinite(funding.runwayHours)
            ? funding.runwayHours
            : null,
          observedLevel: level,
          rechargeMarginBrl: RECHARGE_MARGIN_BRL,
          claimTtlSeconds: CLAIM_TTL_SECONDS,
        });
        let action = claim.decision;
        let messageId: string | null = null;
        let sendError: string | null = null;

        if (claim.shouldSend) {
          if (!claim.token) {
            throw new Error("Alert was claimed without a claim token");
          }

          const sendResult = await sendTemplateMessage(
            waConfig,
            phone,
            template,
            templateLanguage,
            buildMetaBalanceTemplateVariables(accountName, funding),
          );
          messageId = sendResult.messageId;
          sendError =
            sendResult.error || (!sendResult.messageId ? "missing_message_id" : null);
          const sent = !sendError;

          await completeMetaBalanceAlertClaim(
            admin,
            claim,
            sent,
            messageId,
            sendError,
          );
          action = sent ? "sent" : "send_failed";
          if (!sent) failed += 1;
        }

        results.push({
          account: accountName,
          accountId: account.id,
          accountStatus: funding.accountStatus,
          available: Number(funding.availableBrl.toFixed(2)),
          dailyBurn: Number(funding.dailyBurnBrl.toFixed(2)),
          runwayHours: Number.isFinite(funding.runwayHours)
            ? Number(funding.runwayHours.toFixed(2))
            : null,
          level,
          recharged: claim.recharged,
          stateBackend: claim.backend,
          action,
          messageId,
          ...(sendError ? { error: sendError } : {}),
        });
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error("[meta-balance-alert] Account check failed", {
          accountId: account.id,
          error: message,
        });
        await recordCheckError(
          admin,
          account,
          accountName,
          workspaceId,
          message,
        );
        results.push({
          account: accountName,
          accountId: account.id,
          action: "check_failed",
          error: message,
        });
      }
    }

    const status = failed === 0 ? 200 : 500;
    return NextResponse.json(
      {
        ok: failed === 0,
        checkedAt,
        workspaceId,
        thresholds,
        results,
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[meta-balance-alert] Cron failed", { error: message });
    return NextResponse.json(
      { ok: false, checkedAt, error: message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

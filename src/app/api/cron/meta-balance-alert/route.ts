import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getAdAccountFunding, runWithToken } from "@/lib/meta-api";
import { getWapiConfig, sendText } from "@/lib/wapi-api";

export const maxDuration = 120;

// Contas + token de env (mesmo mapa dos scripts: DST=BK BACKUP, SRC=B7984).
const ACCOUNTS = [
  { id: "act_1613880720305953", label: "BK BACKUP", tokenEnv: "META_DST_ACCESS_TOKEN" },
  { id: "act_1234583478774369", label: "B7984", tokenEnv: "META_SRC_TOKEN" },
];

const WARN_HOURS = Number(process.env.META_BALANCE_WARN_HOURS || 4);
const CRIT_HOURS = Number(process.env.META_BALANCE_CRIT_HOURS || 1);
const PHONE = process.env.META_BALANCE_ALERT_PHONE || "5562985955001";
const RECHARGE_MARGIN_BRL = 50; // saldo subiu mais que isso entre checagens = recarga

const brl = (n: number) => "R$" + Math.round(n).toLocaleString("pt-BR");
const rank = (l: string) => (l === "critical" ? 2 : l === "warn" ? 1 : 0);

// Valor sugerido pra durar ~8h, arredondado pra R$500, teto R$1.000 (limite de recarga).
function suggestTopup(dailyBurnBrl: number): number {
  const toLast8h = (dailyBurnBrl / 24) * 8;
  const rounded = Math.ceil(toLast8h / 500) * 500;
  return Math.min(1000, Math.max(500, rounded || 500));
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Workspace com W-API conectado (de onde o alerta é enviado).
  const { data: wc } = await admin
    .from("wapi_config")
    .select("workspace_id")
    .eq("connected", true)
    .limit(1)
    .maybeSingle();
  const workspaceId = process.env.META_BALANCE_ALERT_WORKSPACE_ID || wc?.workspace_id;

  const results: Record<string, unknown>[] = [];

  for (const acc of ACCOUNTS) {
    try {
      const token = process.env[acc.tokenEnv];
      if (!token) {
        results.push({ account: acc.label, error: "no token" });
        continue;
      }

      const f = await runWithToken(token, () => getAdAccountFunding(acc.id));
      const level =
        f.runwayHours < CRIT_HOURS
          ? "critical"
          : f.runwayHours < WARN_HOURS
            ? "warn"
            : "ok";

      const { data: prev } = await admin
        .from("meta_balance_alerts")
        .select("last_available, last_alert_level, last_alert_at")
        .eq("account_id", acc.id)
        .maybeSingle();

      // Recarga detectada -> zera o estado (permite re-alertar num novo ciclo).
      const recharged =
        prev?.last_available != null &&
        f.availableBrl > Number(prev.last_available) + RECHARGE_MARGIN_BRL;
      const lastLevel = recharged ? "ok" : prev?.last_alert_level || "ok";

      // Só dispara ao ESCALAR (ok->warn, warn->critical); não repete o mesmo nível.
      const shouldAlert = rank(level) > rank(lastLevel);

      let sent = false;
      if (shouldAlert && workspaceId) {
        const cfg = await getWapiConfig(workspaceId);
        if (cfg) {
          const runwayTxt =
            f.runwayHours < 1
              ? `~${Math.max(1, Math.round(f.runwayHours * 60))}min`
              : `~${f.runwayHours.toFixed(1)}h`;
          const msg =
            level === "critical"
              ? `🔴 ${acc.label} vai PARAR em ${runwayTxt}\nSaldo ${brl(f.availableBrl)} · queima ${brl(f.dailyBurnBrl)}/dia\nRecarrega AGORA (${brl(suggestTopup(f.dailyBurnBrl))}).`
              : `⚠️ ${acc.label}: saldo baixo\n${brl(f.availableBrl)} · queima ${brl(f.dailyBurnBrl)}/dia · ${runwayTxt}\nRecarrega ~${brl(suggestTopup(f.dailyBurnBrl))} pra durar até a noite.`;
          await sendText(cfg, PHONE, msg);
          sent = true;
        }
      }

      const newLevel =
        level === "ok" ? "ok" : shouldAlert ? level : lastLevel;

      await admin.from("meta_balance_alerts").upsert(
        {
          account_id: acc.id,
          account_name: acc.label,
          last_available: f.availableBrl,
          last_alert_level: newLevel,
          last_alert_at: sent
            ? new Date().toISOString()
            : (prev?.last_alert_at ?? null),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "account_id" },
      );

      results.push({
        account: acc.label,
        available: Math.round(f.availableBrl),
        dailyBurn: Math.round(f.dailyBurnBrl),
        runwayHours: Number(f.runwayHours.toFixed(2)),
        level,
        sent,
      });
    } catch (e) {
      results.push({
        account: acc.label,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({ ok: true, results });
}

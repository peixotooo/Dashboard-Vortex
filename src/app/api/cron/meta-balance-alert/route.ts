import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getAdAccountFunding, runWithToken } from "@/lib/meta-api";
import { getWaConfig, sendTemplateMessage } from "@/lib/whatsapp-api";

export const maxDuration = 120;

// Contas + token de env (mesmo mapa dos scripts: DST=BK BACKUP, SRC=B7984).
const ACCOUNTS = [
  { id: "act_1613880720305953", label: "BK BACKUP", tokenEnv: "META_DST_ACCESS_TOKEN" },
  { id: "act_1234583478774369", label: "B7984", tokenEnv: "META_SRC_TOKEN" },
];

// Warn em 2,5h: acima do que um top-up de R$500 dura (~3,8h na BK), então uma
// recarga pequena já limpa o limiar e não re-alerta em seguida.
const WARN_HOURS = Number(process.env.META_BALANCE_WARN_HOURS || 2.5);
const CRIT_HOURS = Number(process.env.META_BALANCE_CRIT_HOURS || 1);
const PHONE = process.env.META_BALANCE_ALERT_PHONE || "5562985955001";
// Template UTILITY oficial (Cloud API). Enviado do número dedicado da WABA — o
// time que usa o número do W-API NÃO vê estas mensagens.
const TEMPLATE = process.env.META_BALANCE_ALERT_TEMPLATE || "meta_saldo_baixo";
const TEMPLATE_LANG = process.env.META_BALANCE_ALERT_TEMPLATE_LANG || "pt_BR";
const RECHARGE_MARGIN_BRL = 50; // saldo subiu mais que isso entre checagens = recarga

const brl = (n: number) => "R$" + Math.round(n).toLocaleString("pt-BR");
const rank = (l: string) => (l === "critical" ? 2 : l === "warn" ? 1 : 0);
const runwayText = (h: number) =>
  h < 1 ? `~${Math.max(1, Math.round(h * 60))} min` : `~${h.toFixed(1)}h`;

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

  // Workspace com WhatsApp Cloud API (wa_config) configurado.
  const { data: waRow } = await admin
    .from("wa_config")
    .select("workspace_id")
    .not("phone_number_id", "is", null)
    .limit(1)
    .maybeSingle();
  const workspaceId =
    process.env.META_BALANCE_ALERT_WORKSPACE_ID || waRow?.workspace_id;
  const waConfig = workspaceId ? await getWaConfig(workspaceId) : null;

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
      if (shouldAlert && waConfig) {
        const r = await sendTemplateMessage(waConfig, PHONE, TEMPLATE, TEMPLATE_LANG, {
          "1": acc.label,
          "2": brl(f.availableBrl),
          "3": runwayText(f.runwayHours),
          "4": brl(f.dailyBurnBrl) + "/dia",
          "5": brl(suggestTopup(f.dailyBurnBrl)),
        });
        sent = !r.error;
        if (r.error) {
          results.push({ account: acc.label, sendError: r.error });
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

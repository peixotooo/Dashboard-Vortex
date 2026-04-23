import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";
import { getOrCreateConfig } from "@/lib/cashback/api";
import {
  getVndaCreditsConfigFromDb,
  getVndaBalance,
} from "@/lib/cashback/vnda-credits";
import { getSmtpConfig } from "@/lib/cashback/locaweb-smtp";
import { getTroqueConfig, getExchangesForOrder } from "@/lib/cashback/troquecommerce";
import { getWaConfig } from "@/lib/whatsapp-api";

export const maxDuration = 30;

interface Probe {
  name: string;
  ok: boolean;
  detail?: string;
}

export async function GET(request: NextRequest) {
  const { auth, error } = await authRoute(request);
  if (error) return error;

  const probes: Probe[] = [];

  // 1. cashback_config
  const cfg = await getOrCreateConfig(auth!.workspaceId, auth!.admin);
  probes.push({
    name: "cashback_config",
    ok: true,
    detail: `%: ${cfg.percentage} | channel_mode: ${cfg.channel_mode} | flags → deposit:${cfg.enable_deposit} refund:${cfg.enable_refund} wa:${cfg.enable_whatsapp} email:${cfg.enable_email} troque:${cfg.enable_troquecommerce}`,
  });

  // 2. VNDA connection + enable_cashback
  const { data: vndaConns } = await auth!.admin
    .from("vnda_connections")
    .select("id, store_host, enable_cashback")
    .eq("workspace_id", auth!.workspaceId);
  const enabled = (vndaConns || []).filter((c) => c.enable_cashback);
  probes.push({
    name: "vnda_connection.enable_cashback",
    ok: enabled.length > 0,
    detail: enabled.length
      ? enabled.map((c) => c.store_host).join(", ")
      : "nenhuma conexão VNDA com cashback habilitado",
  });

  // 3. VNDA credits API (read-only probe via /credits/balance)
  const vndaCreds = await getVndaCreditsConfigFromDb(auth!.workspaceId, auth!.admin);
  if (!vndaCreds) {
    probes.push({ name: "vnda_credits_api", ok: false, detail: "sem api_token VNDA" });
  } else {
    const probeEmail = request.nextUrl.searchParams.get("email") || "probe+diag@bulkingclub.com.br";
    const bal = await getVndaBalance(vndaCreds, probeEmail);
    probes.push({
      name: "vnda_credits_api",
      ok: bal.balance !== null || typeof bal.raw === "object",
      detail: `probe email=${probeEmail} balance=${bal.balance ?? "?"}`,
    });
  }

  // 4. SMTP (Locaweb) — verifica config; envio real só pela rota send-test
  const smtp = await getSmtpConfig(auth!.workspaceId, auth!.admin);
  probes.push({
    name: "smtp_config",
    ok: Boolean(smtp),
    detail: smtp ? `${smtp.provider} · from=${smtp.fromEmail}` : "não configurado",
  });

  // 5. Troquecommerce — probe com order code fake (200 = token válido, retorna lista vazia)
  const troque = await getTroqueConfig(auth!.workspaceId, auth!.admin);
  if (!troque) {
    probes.push({ name: "troquecommerce_config", ok: false, detail: "não configurado" });
  } else {
    const ex = await getExchangesForOrder(troque, "diagnostic-probe-0000");
    probes.push({
      name: "troquecommerce_config",
      ok: typeof ex.raw === "object",
      detail: `probe ok — lookup retornou ${ex.count} trocas (esperado 0)`,
    });
  }

  // 6. WhatsApp (Meta) config
  const wa = await getWaConfig(auth!.workspaceId);
  probes.push({
    name: "whatsapp_config",
    ok: Boolean(wa),
    detail: wa ? `phone_number_id=${wa.phoneNumberId}` : "não configurado",
  });

  // 7. Templates preenchidos
  const { data: templates } = await auth!.admin
    .from("cashback_reminder_templates")
    .select("canal, estagio, enabled, wa_template_name, email_subject, email_body_html")
    .eq("workspace_id", auth!.workspaceId);
  const byStage = new Map<string, { wa: boolean; email: boolean }>();
  for (const t of templates || []) {
    const s = byStage.get(t.estagio as string) || { wa: false, email: false };
    if (t.canal === "whatsapp" && t.wa_template_name) s.wa = true;
    if (t.canal === "email" && t.email_subject && t.email_body_html) s.email = true;
    byStage.set(t.estagio as string, s);
  }
  const stages = ["LEMBRETE_1", "LEMBRETE_2", "LEMBRETE_3", "REATIVACAO", "REATIVACAO_LEMBRETE"];
  const missing = stages.filter((s) => {
    const v = byStage.get(s);
    return !v || (!v.wa && !v.email);
  });
  probes.push({
    name: "templates",
    ok: missing.length === 0,
    detail: missing.length ? `sem template em: ${missing.join(", ")}` : `todos os 5 estágios preenchidos`,
  });

  // 8. Webhook endpoint em vnda_webhook_logs (últimas 24h)
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const { data: recentLogs } = await auth!.admin
    .from("vnda_webhook_logs")
    .select("status, created_at")
    .eq("workspace_id", auth!.workspaceId)
    .gte("created_at", yesterday.toISOString());
  const logs = recentLogs || [];
  const successCount = logs.filter((l) => l.status === "success").length;
  probes.push({
    name: "webhook_activity_24h",
    ok: logs.length > 0,
    detail: `${logs.length} chamadas nas últimas 24h (${successCount} success)`,
  });

  const allOk = probes.every((p) => p.ok);
  return NextResponse.json({ ok: allOk, probes });
}

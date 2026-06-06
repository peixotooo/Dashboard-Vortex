import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

// Visão única das réguas automáticas + feed de contatos recentes (crm_message_log).
// Leituras cross-feature são best-effort (try/catch) — se uma tabela mudar, a
// régua só não aparece, sem quebrar a página.
async function safeCount(fn: () => Promise<number | null>): Promise<number | null> {
  try { return await fn(); } catch { return null; }
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const admin = createAdminClient();

    // --- Régua de reviews (conhecida) ---
    const { data: rs } = await admin
      .from("review_settings")
      .select("request_enabled, request_channel, rewards_enabled, request_delay_days, request_days_after_invoice, request_require_invoice, request_reminder_days")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const { data: reqRows } = await admin
      .from("review_requests")
      .select("status")
      .eq("workspace_id", workspaceId)
      .limit(5000);
    const reviewCounts: Record<string, number> = {};
    for (const r of reqRows || []) reviewCounts[r.status] = (reviewCounts[r.status] || 0) + 1;

    // --- Outras réguas (best-effort) ---
    const cartRules = await safeCount(async () => {
      const { count } = await admin.from("cart_recovery_rules").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("enabled", true);
      return count ?? 0;
    });
    const cashbackActive = await safeCount(async () => {
      const { count } = await admin.from("cashback_transactions").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "ATIVO");
      return count ?? 0;
    });
    const campaignsRecent = await safeCount(async () => {
      const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
      const { count } = await admin.from("wa_campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("created_at", cutoff);
      return count ?? 0;
    });

    const reguas = [
      {
        key: "review",
        label: "Avaliações (pós-compra)",
        enabled: !!rs?.request_enabled,
        channel: rs?.request_channel ?? "whatsapp",
        detail: `${reviewCounts["pending"] || 0} agendadas · ${reviewCounts["sent"] || 0} enviadas · ${reviewCounts["completed"] || 0} concluídas`,
      },
      { key: "cashback", label: "Cashback (lembretes)", enabled: cashbackActive !== null && cashbackActive > 0, channel: "whatsapp/email", detail: cashbackActive === null ? "—" : `${cashbackActive} créditos ativos` },
      { key: "cart_recovery", label: "Recuperação de carrinho", enabled: cartRules !== null && cartRules > 0, channel: "whatsapp/email", detail: cartRules === null ? "—" : `${cartRules} regras ativas` },
      { key: "campaign", label: "Campanhas WhatsApp", enabled: campaignsRecent !== null && campaignsRecent > 0, channel: "whatsapp", detail: campaignsRecent === null ? "—" : `${campaignsRecent} nos últimos 30d` },
    ];

    // --- Feed de contatos recentes (log unificado) ---
    const { data: recent } = await admin
      .from("crm_message_log")
      .select("customer_email, customer_phone, channel, source, status, sent_at")
      .eq("workspace_id", workspaceId)
      .order("sent_at", { ascending: false })
      .limit(50);

    // --- Plano (flow) das réguas: sequência planejada por régua ---
    const reviewSteps: { label: string; when: string; kind: "event" | "gate" | "send" | "wait" }[] = [
      { label: "Compra confirmada", when: "Dia 0", kind: "event" },
    ];
    if (rs?.request_require_invoice ?? true) {
      reviewSteps.push({ label: "Pedido despachado", when: "espera o rastreio", kind: "gate" });
      reviewSteps.push({ label: "Pedido de avaliação", when: `despacho + ${rs?.request_days_after_invoice ?? 9} dias`, kind: "send" });
    } else {
      reviewSteps.push({ label: "Pedido de avaliação", when: `compra + ${rs?.request_delay_days ?? 15} dias`, kind: "send" });
    }
    if (rs?.request_reminder_days) {
      reviewSteps.push({ label: "Lembrete", when: `+ ${rs.request_reminder_days} dias`, kind: "send" });
    }

    const plan = {
      cooldown_hours: 18,
      lanes: [
        {
          key: "review",
          label: "Avaliações (pós-compra)",
          channel: rs?.request_channel ?? "whatsapp",
          enabled: !!rs?.request_enabled,
          steps: reviewSteps,
        },
        {
          key: "cashback",
          label: "Cashback (lembretes)",
          channel: "whatsapp/email",
          enabled: cashbackActive !== null && cashbackActive > 0,
          steps: [
            { label: "Crédito na carteira", when: "Dia 0", kind: "event" as const },
            { label: "Pedido despachado", when: "espera o rastreio", kind: "gate" as const },
            { label: "Lembrete 1", when: "após despacho", kind: "send" as const },
            { label: "Lembrete 2", when: "+ 5 dias", kind: "send" as const },
            { label: "Lembrete 3", when: "antes de expirar", kind: "send" as const },
          ],
        },
      ],
    };

    return NextResponse.json({ reguas, recent: recent || [], cooldown_hours: 18, plan });
  } catch (e) {
    return handleAuthError(e);
  }
}

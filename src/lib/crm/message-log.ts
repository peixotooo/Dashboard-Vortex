import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";

// Log unificado de comunicações automáticas (réguas) + guard anti-sobreposição.
//
// A régua de reviews registra cada envio em crm_message_log e, ANTES de enviar,
// consulta o "último contato" do cliente em qualquer régua — incluindo as que
// ainda não escrevem em crm_message_log (cashback, campanhas WhatsApp) lendo as
// tabelas delas direto. Assim evitamos mandar review junto de cashback, etc.

export interface LogInput {
  workspaceId: string;
  email?: string | null;
  phone?: string | null;
  channel: "whatsapp" | "email";
  source: "review" | "cashback" | "cart_recovery" | "campaign" | "playbook" | "group";
  sourceId?: string | null;
  status?: "sent" | "failed";
  messageId?: string | null;
  meta?: Record<string, unknown> | null;
}

export async function logCommunication(input: LogInput, admin: SupabaseClient = createAdminClient()): Promise<void> {
  try {
    await admin.from("crm_message_log").insert({
      workspace_id: input.workspaceId,
      customer_email: input.email ?? null,
      customer_phone: input.phone ?? null,
      channel: input.channel,
      source: input.source,
      source_id: input.sourceId ?? null,
      status: input.status ?? "sent",
      message_id: input.messageId ?? null,
      meta: input.meta ?? null,
      sent_at: new Date().toISOString(),
    });
  } catch {
    // log não pode quebrar o envio
  }
}

export interface RecentContact {
  source: string;
  channel: string | null;
  at: string;
}

/**
 * Último(s) contato(s) com o cliente nas últimas `withinHours` horas, em
 * QUALQUER régua. Lê crm_message_log + (best-effort) wa_messages e
 * cashback_transactions. Cada fonte é isolada em try/catch.
 */
export async function getRecentContacts(
  workspaceId: string,
  opts: { email?: string | null; phone?: string | null; withinHours: number },
  admin: SupabaseClient = createAdminClient()
): Promise<RecentContact[]> {
  const cutoff = new Date(Date.now() - opts.withinHours * 3600_000).toISOString();
  const out: RecentContact[] = [];

  // 1) Log unificado (todas as réguas que já escrevem aqui).
  try {
    let q = admin
      .from("crm_message_log")
      .select("source, channel, sent_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "sent")
      .gte("sent_at", cutoff)
      .order("sent_at", { ascending: false })
      .limit(10);
    const ors: string[] = [];
    if (opts.email) ors.push(`customer_email.eq.${opts.email}`);
    if (opts.phone) ors.push(`customer_phone.eq.${opts.phone}`);
    if (ors.length) q = q.or(ors.join(","));
    const { data } = await q;
    for (const r of data || []) out.push({ source: r.source, channel: r.channel, at: r.sent_at });
  } catch { /* ignore */ }

  // 2) Campanhas WhatsApp (wa_messages) — por telefone.
  if (opts.phone) {
    try {
      const { data } = await admin
        .from("wa_messages")
        .select("sent_at, status")
        .eq("workspace_id", workspaceId)
        .eq("phone", opts.phone)
        .in("status", ["sent", "delivered", "read"])
        .gte("sent_at", cutoff)
        .order("sent_at", { ascending: false })
        .limit(1);
      for (const r of data || []) out.push({ source: "campaign", channel: "whatsapp", at: r.sent_at });
    } catch { /* ignore */ }
  }

  // 3) Cashback (cashback_transactions) — por email, qualquer lembrete recente.
  if (opts.email) {
    try {
      const { data } = await admin
        .from("cashback_transactions")
        .select("lembrete1_enviado_em, lembrete2_enviado_em, lembrete3_enviado_em, reativacao_enviado_em")
        .eq("workspace_id", workspaceId)
        .eq("email", opts.email)
        .limit(20);
      for (const r of data || []) {
        const stamps = [r.lembrete1_enviado_em, r.lembrete2_enviado_em, r.lembrete3_enviado_em, r.reativacao_enviado_em]
          .filter(Boolean) as string[];
        for (const s of stamps) {
          if (s >= cutoff) out.push({ source: "cashback", channel: null, at: s });
        }
      }
    } catch { /* ignore */ }
  }

  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

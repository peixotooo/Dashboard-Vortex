import { createAdminClient } from "@/lib/supabase-admin";
import { getVndaConfigAdmin, getVndaOrders } from "@/lib/vnda-api";
import { ml } from "@/lib/ml/client";
import { invalidateEngineCache } from "./engine";

// ============================================================
// Receitas automáticas (VNDA + Mercado Livre)
//
// Replica o lançamento diário que o financeiro fazia à mão no SenseBoard:
// UM lançamento agregado por DIA por CANAL — parceiro VNDA ou MERCADO LIVRE,
// classificação "Receita de Vendas", competência/vencimento no dia, PENDENTE
// e sem conta (o caixa entra pelos saques do gateway, como no modelo Sense).
//
// Valores comprovados contra os lançamentos manuais de 01–07/07/2026:
//  - VNDA = soma de `total` dos pedidos CONFIRMADOS, agrupados por confirmed_at
//    (bateu ao centavo nos dias conferidos).
//  - ML   = soma de `paid_amount` dos pedidos paid/shipped/delivered por
//    date_created (5/7 dias ao centavo; as 2 diferenças eram erros do processo
//    manual: pedido cancelado depois do lançamento e pedido de 23h30 perdido).
//
// Idempotência: cada lançamento carrega doc_number "AUTO-VNDA-2026-07-08" /
// "AUTO-ML-2026-07-08" — o sync procura por ele e ATUALIZA em vez de duplicar.
// A janela recente é re-sincronizada a cada rodada para absorver cancelamentos
// e pedidos tardios; um lançamento AUTO excluído à mão NÃO volta.
// ============================================================

const REVENUE_CLASSIFICATION_PATH = "Receita de Vendas - Receita de Vendas";
const WINDOW_DAYS = 7; // dias re-verificados a cada sync (cancelamentos/tardios)
const ML_PAID_STATUSES = new Set(["paid", "shipped", "delivered"]);

export type AutoRevenueConfig = {
  enabled?: boolean;
  start_date?: string; // nunca cria lançamentos antes desta data (anti-sobreposição)
  last_run?: { at: string; ok: boolean; summary: string };
};

export type SyncResult = {
  day: string;
  channel: "vnda" | "ml";
  amount: number;
  action: "created" | "updated" | "unchanged" | "no_sales" | "skipped_manual" | "skipped_deleted" | "error";
  detail?: string;
};

const CHANNELS = {
  vnda: { partner: "VNDA", docPrefix: "AUTO-VNDA-" },
  ml: { partner: "MERCADO LIVRE", docPrefix: "AUTO-ML-" },
} as const;

// datas em horário de Brasília (cron roda em UTC)
const brtDate = (epochMs: number) => new Date(epochMs - 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function readAutoRevenueConfig(workspaceId: string): Promise<{ config: AutoRevenueConfig; cashPlanning: Record<string, unknown> }> {
  const admin = createAdminClient();
  const { data } = await admin.from("fin_settings").select("cash_planning").eq("workspace_id", workspaceId).maybeSingle();
  const cashPlanning = (data?.cash_planning ?? {}) as Record<string, unknown>;
  return { config: (cashPlanning.auto_receitas ?? {}) as AutoRevenueConfig, cashPlanning };
}

export async function writeAutoRevenueConfig(workspaceId: string, patch: Partial<AutoRevenueConfig>): Promise<AutoRevenueConfig> {
  const admin = createAdminClient();
  const { config, cashPlanning } = await readAutoRevenueConfig(workspaceId);
  const next = { ...config, ...patch };
  const { error } = await admin.from("fin_settings").upsert(
    { workspace_id: workspaceId, cash_planning: { ...cashPlanning, auto_receitas: next }, updated_at: new Date().toISOString() },
    { onConflict: "workspace_id" }
  );
  if (error) throw error;
  return next;
}

async function fetchVndaDaily(workspaceId: string, from: string, to: string): Promise<Map<string, number>> {
  const config = await getVndaConfigAdmin(workspaceId);
  if (!config) throw new Error("VNDA não conectada neste workspace");
  const orders = await getVndaOrders({ config, startDate: from, endDate: to, status: "confirmed" });
  const byDay = new Map<string, number>();
  for (const o of orders) {
    // confirmed_at vem com offset -03:00 → slice já é a data BRT
    const day = (o.confirmed_at || "").slice(0, 10);
    if (!day || day < from || day > to) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + (o.total || 0));
  }
  return byDay;
}

async function fetchMlDaily(workspaceId: string, from: string, to: string): Promise<Map<string, number>> {
  const admin = createAdminClient();
  const { data: cred } = await admin.from("ml_credentials").select("ml_user_id").eq("workspace_id", workspaceId).limit(1).maybeSingle();
  if (!cred?.ml_user_id) throw new Error("Mercado Livre não conectado neste workspace");
  const toExclusive = addDays(to, 1);
  const byDay = new Map<string, number>();
  let offset = 0;
  const limit = 51;
  for (let page = 0; page < 40; page++) {
    const j = await ml.get<{ results?: Array<{ status: string; paid_amount?: number; total_amount?: number; date_created?: string }>; paging?: { total?: number } }>(
      `/orders/search?seller=${cred.ml_user_id}` +
        `&order.date_created.from=${from}T00:00:00.000-03:00` +
        `&order.date_created.to=${toExclusive}T00:00:00.000-03:00` +
        `&limit=${limit}&offset=${offset}`,
      workspaceId
    );
    const results = j.results ?? [];
    for (const o of results) {
      if (!ML_PAID_STATUSES.has(o.status)) continue;
      const created = o.date_created ? Date.parse(o.date_created) : NaN;
      if (!Number.isFinite(created)) continue;
      const day = brtDate(created);
      if (day < from || day > to) continue;
      byDay.set(day, (byDay.get(day) ?? 0) + (o.paid_amount ?? o.total_amount ?? 0));
    }
    offset += results.length;
    if (results.length < limit || offset >= (j.paging?.total ?? 0)) break;
  }
  return byDay;
}

/**
 * Sincroniza os lançamentos automáticos de receita de um workspace.
 * Janela: max(start_date, ontem-6) até ONTEM (dia fechado) em BRT.
 */
export async function syncAutoRevenue(workspaceId: string, opts?: { force?: boolean }): Promise<{ ran: boolean; results: SyncResult[]; summary: string }> {
  const { config } = await readAutoRevenueConfig(workspaceId);
  if (!config.enabled && !opts?.force) return { ran: false, results: [], summary: "automação desativada" };

  const admin = createAdminClient();
  const yesterday = addDays(brtDate(Date.now()), -1);
  const windowStart = addDays(yesterday, -(WINDOW_DAYS - 1));
  const from = config.start_date && config.start_date > windowStart ? config.start_date : windowStart;
  if (from > yesterday) return { ran: false, results: [], summary: "start_date no futuro — nada a sincronizar" };

  // classificação de receita (a mesma dos lançamentos manuais do financeiro)
  const { data: cls } = await admin
    .from("fin_classifications")
    .select("id, flow")
    .eq("workspace_id", workspaceId)
    .eq("path", REVENUE_CLASSIFICATION_PATH)
    .maybeSingle();
  if (!cls) throw new Error(`classificação "${REVENUE_CLASSIFICATION_PATH}" não encontrada`);

  const results: SyncResult[] = [];
  const nowIso = new Date().toISOString();

  for (const channel of ["vnda", "ml"] as const) {
    const { partner, docPrefix } = CHANNELS[channel];
    let byDay: Map<string, number>;
    try {
      byDay = channel === "vnda" ? await fetchVndaDaily(workspaceId, from, yesterday) : await fetchMlDaily(workspaceId, from, yesterday);
    } catch (e) {
      results.push({ day: from, channel, amount: 0, action: "error", detail: e instanceof Error ? e.message : String(e) });
      continue;
    }

    const { data: partnerRow, error: pErr } = await admin
      .from("fin_partners")
      .upsert({ workspace_id: workspaceId, name: partner }, { onConflict: "workspace_id,name" })
      .select("id")
      .single();
    if (pErr) throw pErr;

    for (let day = from; day <= yesterday; day = addDays(day, 1)) {
      const amount = Math.round((byDay.get(day) ?? 0) * 100) / 100;
      const doc = docPrefix + day;

      // procura o lançamento AUTO deste dia/canal (inclusive excluídos —
      // exclusão manual é respeitada e o robô não recria)
      const { data: existing } = await admin
        .from("fin_entries")
        .select("id, amount, deleted_at")
        .eq("workspace_id", workspaceId)
        .eq("doc_number", doc)
        .order("deleted_at", { ascending: true, nullsFirst: true }) // linha viva vence
        .limit(1)
        .maybeSingle();

      if (existing?.deleted_at) {
        results.push({ day, channel, amount, action: "skipped_deleted" });
        continue;
      }
      if (existing) {
        if (Math.abs(Number(existing.amount) - amount) < 0.005) {
          results.push({ day, channel, amount, action: "unchanged" });
        } else {
          const { error } = await admin
            .from("fin_entries")
            .update({
              amount,
              observation: `Receita ${partner} do dia ${day} (automático). Atualizado em ${nowIso.slice(0, 16)}Z — pedidos cancelados/tardios são absorvidos por até ${WINDOW_DAYS} dias.`,
              updated_at: nowIso,
            })
            .eq("id", existing.id);
          if (error) throw error;
          results.push({ day, channel, amount, action: "updated", detail: `antes R$ ${existing.amount}` });
        }
        continue;
      }

      if (amount <= 0) {
        results.push({ day, channel, amount, action: "no_sales" });
        continue;
      }

      // anti-sobreposição: se o financeiro JÁ lançou a receita desse dia/canal
      // à mão (mesmo dia + parceiro + classificação, sem doc AUTO), não duplica
      const { data: manual } = await admin
        .from("fin_entries")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("due_date", day)
        .eq("partner_id", partnerRow.id)
        .eq("classification_id", cls.id)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();
      if (manual) {
        results.push({ day, channel, amount, action: "skipped_manual" });
        continue;
      }

      const { error } = await admin.from("fin_entries").insert({
        workspace_id: workspaceId,
        doc_number: doc,
        description: null,
        observation: `Receita ${partner} do dia ${day} (lançamento automático — soma dos pedidos ${channel === "vnda" ? "confirmados na VNDA" : "pagos no Mercado Livre"}).`,
        partner_id: partnerRow.id,
        classification_id: cls.id,
        bank_account_id: null,
        competence_date: day,
        due_date: day,
        paid_at: null, // pendente, como no modelo Sense (caixa entra pelos saques)
        amount,
        flow: cls.flow,
        kind: "normal",
        source: "vnda", // única fonte automática permitida pelo CHECK; canal fica no doc_number
        source_created_at: nowIso,
        source_created_by: "auto-receitas",
      });
      if (error) throw error;
      results.push({ day, channel, amount, action: "created" });
    }
  }

  invalidateEngineCache(workspaceId);

  const count = (a: SyncResult["action"]) => results.filter((r) => r.action === a).length;
  const summary = `criados ${count("created")}, atualizados ${count("updated")}, sem mudança ${count("unchanged")}, erros ${count("error")}`;
  await writeAutoRevenueConfig(workspaceId, { last_run: { at: nowIso, ok: count("error") === 0, summary } });
  return { ran: true, results, summary };
}

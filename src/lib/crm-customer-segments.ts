import type { SupabaseClient } from "@supabase/supabase-js";
import type { RfmCustomer } from "@/lib/crm-rfm";

const SEGMENT_BATCH_SIZE = 500;

export function crmCustomerSegmentRow(workspaceId: string, c: RfmCustomer, updatedAt: string) {
  return {
    workspace_id: workspaceId,
    email: c.email,
    nome: c.name || null,
    telefone: c.phone || null,
    total_compras: c.totalPurchases,
    total_gasto: c.totalSpent,
    ticket_medio: c.avgTicket,
    primeira_compra: c.firstPurchaseDate === "—" ? null : c.firstPurchaseDate,
    ultima_compra: c.lastPurchaseDate === "—" ? null : c.lastPurchaseDate,
    dias_sem_comprar: c.daysSinceLastPurchase,
    score_recencia: c.recencyScore,
    score_frequencia: c.frequencyScore,
    score_monetario: c.monetaryScore,
    rfm_score: c.rfmScore,
    segmento_rfm: c.segment,
    faixa_dia_mes: c.preferredDayRange,
    dia_semana_preferido: c.preferredDayOfWeek,
    dia_semana_individual: c.preferredWeekday,
    turno_preferido: c.preferredHour,
    sensibilidade_cupom: c.couponSensitivity,
    estagio_lifecycle: c.lifecycleStage,
    cupons_usados: c.couponsUsed,
    updated_at: updatedAt,
  };
}

export async function syncCrmCustomerSegments(
  client: SupabaseClient,
  workspaceId: string,
  customers: RfmCustomer[]
): Promise<{ upserted: number; deleted: number }> {
  const updatedAt = new Date().toISOString();
  let upserted = 0;

  for (let i = 0; i < customers.length; i += SEGMENT_BATCH_SIZE) {
    const batch = customers
      .slice(i, i + SEGMENT_BATCH_SIZE)
      .map((customer) => crmCustomerSegmentRow(workspaceId, customer, updatedAt));

    const { error } = await client
      .from("crm_customer_segments")
      .upsert(batch, { onConflict: "workspace_id,email" });

    if (error) {
      throw new Error(`CRM customer segments upsert error: ${error.message}`);
    }
    upserted += batch.length;
  }

  const { count, error: deleteError } = await client
    .from("crm_customer_segments")
    .delete({ count: "exact" })
    .eq("workspace_id", workspaceId)
    .lt("updated_at", updatedAt);

  if (deleteError) {
    throw new Error(`CRM customer segments cleanup error: ${deleteError.message}`);
  }

  return { upserted, deleted: count ?? 0 };
}

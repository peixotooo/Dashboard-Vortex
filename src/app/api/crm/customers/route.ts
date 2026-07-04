import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError, AuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import type { RfmCustomer } from "@/lib/crm-rfm";

export const maxDuration = 60;

const PAGE_SIZE = 1000;
const DEFAULT_LIMIT = 70000;
const MAX_LIMIT = 100000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

type SegmentRow = {
  email: string;
  nome: string | null;
  telefone: string | null;
  total_compras: number | null;
  total_gasto: number | null;
  ticket_medio: number | null;
  primeira_compra: string | null;
  ultima_compra: string | null;
  dias_sem_comprar: number | null;
  score_recencia: number | null;
  score_frequencia: number | null;
  score_monetario: number | null;
  rfm_score: string | null;
  segmento_rfm: string | null;
  faixa_dia_mes: string | null;
  dia_semana_preferido: string | null;
  dia_semana_individual: string | null;
  turno_preferido: string | null;
  sensibilidade_cupom: string | null;
  estagio_lifecycle: string | null;
  cupons_usados: string[] | null;
};

function toCustomer(row: SegmentRow): RfmCustomer {
  const recencyScore = Number(row.score_recencia) || 0;
  const frequencyScore = Number(row.score_frequencia) || 0;
  const monetaryScore = Number(row.score_monetario) || 0;
  return {
    email: row.email,
    name: row.nome || "",
    phone: row.telefone || "",
    totalPurchases: Number(row.total_compras) || 0,
    totalSpent: Number(row.total_gasto) || 0,
    avgTicket: Number(row.ticket_medio) || 0,
    firstPurchaseDate: row.primeira_compra || "—",
    lastPurchaseDate: row.ultima_compra || "—",
    daysSinceLastPurchase: Number(row.dias_sem_comprar) || 9999,
    couponsUsed: Array.isArray(row.cupons_usados) ? row.cupons_usados : [],
    recencyScore,
    frequencyScore,
    monetaryScore,
    rfmScore: row.rfm_score || `${recencyScore}-${frequencyScore}-${monetaryScore}`,
    rfmTotal: recencyScore + frequencyScore + monetaryScore,
    segment: (row.segmento_rfm || "hibernating") as RfmCustomer["segment"],
    preferredDayRange: (row.faixa_dia_mes || "1-5") as RfmCustomer["preferredDayRange"],
    preferredDayOfWeek: (row.dia_semana_preferido || "weekday") as RfmCustomer["preferredDayOfWeek"],
    preferredWeekday: (row.dia_semana_individual || "seg") as RfmCustomer["preferredWeekday"],
    preferredHour: (row.turno_preferido || "manha") as RfmCustomer["preferredHour"],
    couponSensitivity: (row.sensibilidade_cupom || "never") as RfmCustomer["couponSensitivity"],
    lifecycleStage: (row.estagio_lifecycle || "new") as RfmCustomer["lifecycleStage"],
  };
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const limitParamRaw = request.nextUrl.searchParams.get("limit");
    const pageParamRaw = request.nextUrl.searchParams.get("page");
    const pageSizeParamRaw = request.nextUrl.searchParams.get("page_size");
    const limitParam = Number(limitParamRaw || DEFAULT_LIMIT);
    const limit = Math.min(Math.max(1, Math.floor(limitParam)), MAX_LIMIT);
    const page = Math.max(0, Number(pageParamRaw || 0));
    const pageSize = Math.min(
      Math.max(1, Number(pageSizeParamRaw || DEFAULT_PAGE_SIZE)),
      MAX_PAGE_SIZE
    );
    const fetchAll =
      request.nextUrl.searchParams.get("all") === "1" ||
      (limitParamRaw !== null && pageParamRaw === null && pageSizeParamRaw === null);

    const admin = createAdminClient();

    const { data: snapshot, error: snapshotError } = await admin
      .from("crm_rfm_snapshots")
      .select("summary, computed_at")
      .eq("workspace_id", workspaceId)
      .single() as unknown as {
        data: { summary?: { totalCustomers?: number }; computed_at?: string } | null;
        error: { message: string } | null;
      };

    if (snapshotError) {
      return NextResponse.json({ error: snapshotError.message }, { status: 500 });
    }

    const expectedCustomers = Number(snapshot?.summary?.totalCustomers || 0);
    const [{ count: materializedCount, error: countError }, { data: freshnessRows, error: freshnessError }] = await Promise.all([
      admin
        .from("crm_customer_segments")
        .select("email", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),
      admin
        .from("crm_customer_segments")
        .select("updated_at")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false })
        .limit(1),
    ]);

    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }
    if (freshnessError) {
      return NextResponse.json({ error: freshnessError.message }, { status: 500 });
    }

    if (expectedCustomers > 0 && materializedCount !== expectedCustomers) {
      return NextResponse.json(
        {
          error: "crm_customer_segments_out_of_sync",
          message: "A base materializada de clientes esta desatualizada. Rode o recompute do CRM antes de carregar a listagem.",
          expectedCustomers,
          materializedCount: materializedCount ?? 0,
          snapshotComputedAt: snapshot?.computed_at || null,
          materializedUpdatedAt: freshnessRows?.[0]?.updated_at || null,
        },
        { status: 409 }
      );
    }

    const columns = [
      "email",
      "nome",
      "telefone",
      "total_compras",
      "total_gasto",
      "ticket_medio",
      "primeira_compra",
      "ultima_compra",
      "dias_sem_comprar",
      "score_recencia",
      "score_frequencia",
      "score_monetario",
      "rfm_score",
      "segmento_rfm",
      "faixa_dia_mes",
      "dia_semana_preferido",
      "dia_semana_individual",
      "turno_preferido",
      "sensibilidade_cupom",
      "estagio_lifecycle",
      "cupons_usados",
    ].join(",");

    // Supabase's fluent builder changes generic types after each filter; keeping
    // this local builder dynamic avoids leaking those internal generics.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function applyFilters(query: any) {
      const sp = request.nextUrl.searchParams;
      const search = (sp.get("search") || "").trim();
      const segment = sp.get("segment") || "all";
      const dayRange = sp.get("day_range") || "all";
      const lifecycle = sp.get("lifecycle") || "all";
      const hour = sp.get("hour") || "all";
      const coupon = sp.get("coupon") || "all";
      const weekday = sp.get("weekday") || "all";
      const purchasedFrom = sp.get("purchased_from") || "";
      const purchasedTo = sp.get("purchased_to") || "";
      const inactiveFrom = sp.get("inactive_from") || "";
      const avgTicketMin = sp.get("avg_ticket_min");
      const avgTicketMax = sp.get("avg_ticket_max");
      const totalSpentMin = sp.get("total_spent_min");
      const totalSpentMax = sp.get("total_spent_max");

      if (search) {
        const escaped = search.replace(/[%_,]/g, "");
        query = query.or(`nome.ilike.%${escaped}%,email.ilike.%${escaped}%,telefone.ilike.%${escaped}%`);
      }
      if (segment !== "all") query = query.eq("segmento_rfm", segment);
      if (dayRange !== "all") query = query.eq("faixa_dia_mes", dayRange);
      if (lifecycle !== "all") query = query.eq("estagio_lifecycle", lifecycle);
      if (hour !== "all") query = query.eq("turno_preferido", hour);
      if (coupon !== "all") query = query.eq("sensibilidade_cupom", coupon);
      if (weekday !== "all") query = query.eq("dia_semana_individual", weekday);
      if (purchasedFrom) query = query.gte("ultima_compra", purchasedFrom);
      if (purchasedTo) query = query.lte("primeira_compra", purchasedTo);
      if (inactiveFrom) query = query.lt("ultima_compra", inactiveFrom);
      if (avgTicketMin !== null && avgTicketMin !== "") query = query.gte("ticket_medio", Number(avgTicketMin));
      if (avgTicketMax !== null && avgTicketMax !== "") query = query.lte("ticket_medio", Number(avgTicketMax));
      if (totalSpentMin !== null && totalSpentMin !== "") query = query.gte("total_gasto", Number(totalSpentMin));
      if (totalSpentMax !== null && totalSpentMax !== "") query = query.lte("total_gasto", Number(totalSpentMax));
      return query;
    }

    const customers: RfmCustomer[] = [];
    let from = fetchAll ? 0 : page * pageSize;
    const targetLimit = fetchAll ? limit : pageSize;
    let filteredTotal = materializedCount ?? 0;

    while (customers.length < targetLimit) {
      const chunkSize = fetchAll ? PAGE_SIZE : pageSize;
      const to = Math.min(from + chunkSize - 1, (fetchAll ? limit : from + pageSize) - 1);
      let query = admin
        .from("crm_customer_segments")
        .select(columns, { count: customers.length === 0 ? "exact" : undefined })
        .eq("workspace_id", workspaceId)
        .order("total_gasto", { ascending: false });

      query = applyFilters(query);
      const { data, error, count } = await query.range(from, to);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (typeof count === "number") filteredTotal = count;

      const rows = (data || []) as unknown as SegmentRow[];
      customers.push(...rows.map(toCustomer));
      if (rows.length < chunkSize) break;
      from += chunkSize;
    }

    return NextResponse.json(
      {
        customers,
        total: filteredTotal,
        materializedTotal: materializedCount ?? customers.length,
        expectedCustomers,
        page,
        pageSize: fetchAll ? customers.length : pageSize,
        snapshotComputedAt: snapshot?.computed_at || null,
        materializedUpdatedAt: freshnessRows?.[0]?.updated_at || null,
      },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CRM Customers]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

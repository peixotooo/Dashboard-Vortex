import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { callLLM, resolveModel, DEFAULT_PROVIDER_CONFIG } from "@/lib/agent/llm-provider";
import type { RfmCustomer } from "@/lib/crm-rfm";
import { getCooldownPhones, getExcludedPhones } from "@/lib/wa-compliance";

export const maxDuration = 60;

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const question: string | undefined = body.question;
    const cooldownDays: number = typeof body.cooldownDays === "number" ? body.cooldownDays : 7;

    // Try snapshot first, fetch export logs in parallel
    interface Snapshot {
      summary: unknown; segments: unknown; behavioral: unknown; customers: unknown;
    }

    const [snapshotResult, exportLogs] = await Promise.all([
      supabase
        .from("crm_rfm_snapshots")
        .select("*")
        .eq("workspace_id", workspaceId)
        .single() as unknown as Promise<{ data: Snapshot | null; error: unknown }>,
      fetchExportLogs(supabase, workspaceId),
    ]);

    let reportCustomers: RfmCustomer[];
    let reportSummary: { totalCustomers: number; totalRevenue: number; avgTicket: number; activeCustomers: number; avgPurchasesPerCustomer: number; medianRecency: number };
    let reportSegments: Array<{ segment: string; label: string; customerCount: number; totalRevenue: number; avgTicket: number; avgRecency: number }>;
    let reportBehavioral: Record<string, unknown>;

    if (snapshotResult.data) {
      // Use snapshot
      reportCustomers = snapshotResult.data.customers as RfmCustomer[];
      reportSummary = snapshotResult.data.summary as typeof reportSummary;
      reportSegments = snapshotResult.data.segments as typeof reportSegments;
      reportBehavioral = snapshotResult.data.behavioral as Record<string, unknown>;
    } else {
      // No snapshot — cannot generate suggestions without pre-computed data.
      // Heavy recomputation is handled exclusively by the crm-recompute cron job.
      console.log("[CRM Suggestions] No snapshot found, returning pending state.");
      return NextResponse.json({
        suggestions: [],
        analysis: "Dados sendo processados. Atualize em alguns minutos.",
        pending: true,
      });
    }

    if (reportCustomers.length === 0) {
      return NextResponse.json({
        suggestions: [],
        analysis: "Nenhum dado de CRM encontrado para este workspace. Importe seus dados primeiro.",
      });
    }

    let customers = reportCustomers;

    // "Nao Perturbe" — exclude customers from recent exports + WhatsApp sends + blocklist
    let excludedCount = 0;
    if (cooldownDays > 0) {
      const doNotDisturb = exportLogs.length > 0
        ? buildDoNotDisturbSet(reportCustomers, exportLogs, cooldownDays)
        : new Set<string>();

      // Also exclude by actual WhatsApp sends and permanent blocklist
      const [waCooldownPhones, waBlockedPhones] = await Promise.all([
        getCooldownPhones(workspaceId, cooldownDays),
        getExcludedPhones(workspaceId),
      ]);

      for (const customer of reportCustomers) {
        const phone = customer.phone?.replace(/\D/g, "");
        if (phone && (waCooldownPhones.has(phone) || waBlockedPhones.has(phone))) {
          doNotDisturb.add(customer.email);
        }
      }

      excludedCount = doNotDisturb.size;
      if (excludedCount > 0) {
        customers = customers.filter((c) => !doNotDisturb.has(c.email));
      }
    }

    // Pre-compute real cross-filter counts so the LLM uses exact numbers
    const crossFilterCounts = computeCrossFilterCounts(customers);

    // Build concise data for the LLM
    const crmContext = {
      summary: reportSummary,
      segments: reportSegments.map((s) => ({
        name: s.segment,
        label: s.label,
        count: s.customerCount,
        revenue: s.totalRevenue,
        avgTicket: s.avgTicket,
        avgRecency: s.avgRecency,
      })),
      behavioral: reportBehavioral,
      recentExports: exportLogs.map((e) => ({
        type: e.export_type,
        filters: e.filters,
        count: e.record_count,
        date: e.created_at,
      })),
    };

    const today = new Date().toLocaleDateString("pt-BR", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const systemPrompt = `Voce e Ana, especialista em CRM e hipersegmentacao. Sua unica funcao: analisar dados de CRM e sugerir segmentacoes com alta chance de conversao.

## Dados do CRM (hoje: ${today})

### Resumo
- Total de clientes: ${crmContext.summary.totalCustomers}
- Receita total: R$ ${crmContext.summary.totalRevenue.toFixed(2)}
- Ticket medio: R$ ${crmContext.summary.avgTicket.toFixed(2)}
- Clientes ativos (90 dias): ${crmContext.summary.activeCustomers}
- Media de compras por cliente: ${crmContext.summary.avgPurchasesPerCustomer.toFixed(1)}
- Mediana de recencia: ${crmContext.summary.medianRecency} dias

### Segmentos RFM
${crmContext.segments.map((s) => `- ${s.name} (${s.label}): ${s.count} clientes | recencia: ${s.avgRecency.toFixed(0)}d | ticket: R$${s.avgTicket.toFixed(0)} | receita: R$${s.revenue.toFixed(0)}`).join("\n")}

### Distribuicoes Comportamentais
- Dia da semana: ${JSON.stringify((crmContext.behavioral as Record<string, unknown>).weekday)}
- Horario: ${JSON.stringify((crmContext.behavioral as Record<string, unknown>).hourOfDay)}
- Dia do mes: ${JSON.stringify((crmContext.behavioral as Record<string, unknown>).dayOfMonth)}
- Cupom: ${JSON.stringify((crmContext.behavioral as Record<string, unknown>).couponUsage)}
- Lifecycle: ${JSON.stringify((crmContext.behavioral as Record<string, unknown>).lifecycle)}

### Cruzamentos de Filtros com Contagem REAL
IMPORTANTE: Use APENAS combinacoes desta lista. O campo "count" e o numero EXATO de clientes.
${crossFilterCounts}

### Filtro "Nao Perturbe"
${excludedCount > 0
  ? `- Periodo: ultimos ${cooldownDays} dias
- ${excludedCount} clientes foram EXCLUIDOS por ja terem sido exportados neste periodo
- As contagens de cruzamento acima JA refletem essa exclusao`
  : `- Nenhum cliente excluido (${cooldownDays > 0 ? "sem exportacoes recentes" : "filtro desativado"})`}

### Exportacoes Recentes
${crmContext.recentExports.length > 0
  ? crmContext.recentExports.map((e) => `- ${e.date}: ${e.type} (${e.count} registros) filtros: ${JSON.stringify(e.filters)}`).join("\n")
  : "Nenhuma exportacao recente."}

## Filtros Disponiveis
Os filtros que voce pode sugerir sao:
- segmentFilter: "champions" | "loyal_customers" | "potential_loyalists" | "recent_customers" | "promising" | "need_attention" | "about_to_sleep" | "at_risk" | "cant_lose" | "hibernating" | "lost" | "all"
- lifecycleFilter: "new" | "returning" | "regular" | "vip" | "all"
- couponFilter: "never" | "occasional" | "frequent" | "always" | "all"
- hourFilter: "madrugada" | "manha" | "tarde" | "noite" | "all"
- weekdayFilter: "seg" | "ter" | "qua" | "qui" | "sex" | "sab" | "dom" | "all"
- dayRangeFilter: "1-5" | "6-10" | "11-15" | "16-20" | "21-25" | "26-31" | "all"

## Regras
1. Retorne EXATAMENTE 3 sugestoes de hipersegmentacao criativas
2. Cada sugestao DEVE usar combinacoes da lista "Cruzamentos de Filtros" acima — NUNCA invente contagens
3. O campo "estimatedCount" DEVE ser o valor exato "count" da lista de cruzamentos
4. Filtros que voce nao quer aplicar devem ser "all" (nao omita nenhum filtro do objeto)
5. Explique o MOTIVO da sugestao — por que essa combinacao converte
6. Evite segmentar os mesmos clientes das exportacoes recentes (fadiga)
7. Considere a data atual para timing (dia da semana, periodo do mes)
8. Priorize conversao rapida: segmentos com clientes que TEM potencial mas precisam de um empurrao
9. Escolha combinacoes com pelo menos 10 clientes

## Formato de Resposta
Responda EXCLUSIVAMENTE com JSON valido (sem markdown, sem texto extra):
{
  "suggestions": [
    {
      "name": "Nome curto da segmentacao",
      "description": "Descricao breve do publico",
      "reasoning": "Explicacao detalhada de por que esta combinacao tem alta chance de conversao",
      "filters": {
        "segmentFilter": "valor_ou_all",
        "lifecycleFilter": "valor_ou_all",
        "couponFilter": "valor_ou_all",
        "hourFilter": "valor_ou_all",
        "weekdayFilter": "valor_ou_all",
        "dayRangeFilter": "valor_ou_all"
      },
      "estimatedCount": 123,
      "urgency": "alta | media | baixa"
    }
  ],
  "analysis": "Breve analise geral (1-2 frases) sobre o estado da base"
}`;

    const userMessage = question
      ? `Considerando os dados acima, responda: ${question}\n\nInclua sugestoes de segmentacao relevantes na resposta.`
      : "Analise os dados e sugira 3 hipersegmentacoes com alta chance de conversao.";

    const provider = process.env.OPENROUTER_API_KEY ? "openrouter" : DEFAULT_PROVIDER_CONFIG.provider;
    const config = { ...DEFAULT_PROVIDER_CONFIG, provider };
    const model = resolveModel(config, "mid", "claude-sonnet-4-5-20250929");

    const response = await callLLM({
      provider,
      model,
      maxTokens: 2000,
      system: systemPrompt,
      tools: [],
      messages: [{ role: "user", content: userMessage }],
    });

    // Extract text from response
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ suggestions: [], analysis: "Sem resposta do modelo." });
    }

    // Parse JSON from response (handle markdown code blocks if present)
    let parsed;
    try {
      let jsonStr = textBlock.text.trim();
      // Strip markdown code fences if present
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      parsed = JSON.parse(jsonStr);
    } catch {
      // If parsing fails, return the text as analysis
      return NextResponse.json({
        suggestions: [],
        analysis: textBlock.text,
      });
    }

    return NextResponse.json({ ...parsed, excludedCount, cooldownDays });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CRM Suggestions] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// --- Helpers ---

/**
 * Pre-compute the top cross-filter combinations (segment x lifecycle, segment x coupon, etc.)
 * so the LLM picks from real counts instead of guessing.
 */
function computeCrossFilterCounts(customers: RfmCustomer[]): string {
  type FilterKey = "segment" | "lifecycleStage" | "couponSensitivity" | "preferredHour" | "preferredWeekday" | "preferredDayRange";
  const filterMap: Record<string, FilterKey> = {
    segmentFilter: "segment",
    lifecycleFilter: "lifecycleStage",
    couponFilter: "couponSensitivity",
    hourFilter: "preferredHour",
    weekdayFilter: "preferredWeekday",
    dayRangeFilter: "preferredDayRange",
  };
  const filterKeys = Object.keys(filterMap) as string[];

  // Generate all pairs of filter dimensions
  const pairs: [string, string][] = [];
  for (let i = 0; i < filterKeys.length; i++) {
    for (let j = i + 1; j < filterKeys.length; j++) {
      pairs.push([filterKeys[i], filterKeys[j]]);
    }
  }

  const lines: string[] = [];

  for (const [fA, fB] of pairs) {
    const propA = filterMap[fA];
    const propB = filterMap[fB];
    // Count each combination
    const counts = new Map<string, number>();
    for (const c of customers) {
      const key = `${c[propA]}|${c[propB]}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    // Sort by count descending, take top 5 per pair
    const sorted = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    for (const [key, count] of sorted) {
      if (count < 5) continue;
      const [valA, valB] = key.split("|");
      lines.push(`- ${fA}=${valA} + ${fB}=${valB} → ${count} clientes`);
    }
  }

  return lines.join("\n");
}

/**
 * Replay export log filters on current customer list to build a set of
 * emails that were exported within the cooldown period.
 */
function buildDoNotDisturbSet(
  customers: RfmCustomer[],
  exportLogs: ExportLog[],
  cooldownDays: number
): Set<string> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - cooldownDays);

  // Map Portuguese filter keys (as saved by handleGlobalExport) → RfmCustomer property
  const keyMap: Record<string, keyof RfmCustomer> = {
    segmento: "segment",
    faixa_dia: "preferredDayRange",
    lifecycle: "lifecycleStage",
    turno: "preferredHour",
    cupom: "couponSensitivity",
    dia_semana: "preferredWeekday",
  };

  const emails = new Set<string>();

  for (const log of exportLogs) {
    if (!log.filters || Object.keys(log.filters).length === 0) continue;
    if (new Date(log.created_at) < cutoff) continue;

    // Only consider RFM-based filters (skip busca, date ranges, etc.)
    const rfmFilters = Object.entries(log.filters).filter(([k]) => keyMap[k]);
    if (rfmFilters.length === 0) continue; // no RFM filters → can't replay, skip

    // Find customers that match ALL RFM filters from this export
    for (const customer of customers) {
      let matches = true;
      for (const [filterKey, filterValue] of rfmFilters) {
        const prop = keyMap[filterKey];
        if (customer[prop] !== filterValue) {
          matches = false;
          break;
        }
      }
      if (matches) {
        emails.add(customer.email);
      }
    }
  }

  return emails;
}

interface ExportLog {
  export_type: string;
  filters: Record<string, string> | null;
  record_count: number;
  created_at: string;
}

async function fetchExportLogs(
  supabase: ReturnType<typeof createServerClient>,
  workspaceId: string
): Promise<ExportLog[]> {
  const { data } = await supabase
    .from("crm_export_logs")
    .select("export_type, filters, record_count, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(20);

  return (data as ExportLog[]) || [];
}

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import Anthropic from "@anthropic-ai/sdk";
import { generateRfmReport } from "@/lib/crm-rfm";
import type { CrmVendaRow } from "@/lib/crm-rfm";

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

    // Fetch CRM data and export logs in parallel
    const [crmRows, exportLogs] = await Promise.all([
      fetchAllCrmRows(supabase, workspaceId),
      fetchExportLogs(supabase, workspaceId),
    ]);

    if (crmRows.length === 0) {
      return NextResponse.json({
        suggestions: [],
        analysis: "Nenhum dado de CRM encontrado para este workspace. Importe seus dados primeiro.",
      });
    }

    const report = generateRfmReport(crmRows);

    // Build concise data for the LLM
    const crmContext = {
      summary: report.summary,
      segments: report.segments.map((s) => ({
        name: s.segment,
        label: s.label,
        count: s.customerCount,
        revenue: s.totalRevenue,
        avgTicket: s.avgTicket,
        avgRecency: s.avgRecency,
      })),
      behavioral: report.behavioralDistributions,
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
- Dia da semana: ${JSON.stringify(crmContext.behavioral.weekday)}
- Horario: ${JSON.stringify(crmContext.behavioral.hourOfDay)}
- Dia do mes: ${JSON.stringify(crmContext.behavioral.dayOfMonth)}
- Cupom: ${JSON.stringify(crmContext.behavioral.couponUsage)}
- Lifecycle: ${JSON.stringify(crmContext.behavioral.lifecycle)}

### Exportacoes Recentes (evitar fadiga de contato)
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
2. Cada sugestao DEVE combinar pelo menos 2 filtros diferentes (cross-filter) para hiperpersonalizacao
3. Estime o numero de clientes com base nos dados (cruzamento dos filtros)
4. Explique o MOTIVO da sugestao — por que essa combinacao converte
5. Evite segmentar os mesmos clientes das exportacoes recentes (fadiga)
6. Considere a data atual para timing (dia da semana, periodo do mes)
7. Priorize conversao rapida: segmentos com clientes que TEM potencial mas precisam de um empurrao

## Formato de Resposta
Responda EXCLUSIVAMENTE com JSON valido (sem markdown, sem texto extra):
{
  "suggestions": [
    {
      "name": "Nome curto da segmentacao",
      "description": "Descricao breve do publico",
      "reasoning": "Explicacao detalhada de por que esta combinacao tem alta chance de conversao",
      "filters": {
        "segmentFilter": "...",
        "lifecycleFilter": "...",
        "couponFilter": "...",
        "hourFilter": "...",
        "weekdayFilter": "...",
        "dayRangeFilter": "..."
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

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY nao configurada" }, { status: 500 });
    }
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2000,
      system: systemPrompt,
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

    return NextResponse.json(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CRM Suggestions] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// --- Helpers ---

async function fetchAllCrmRows(
  supabase: ReturnType<typeof createServerClient>,
  workspaceId: string
): Promise<CrmVendaRow[]> {
  const allRows: CrmVendaRow[] = [];
  const PAGE_SIZE = 1000;
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("crm_vendas")
      .select("cliente, email, telefone, valor, data_compra, cupom, numero_pedido, compras_anteriores")
      .eq("workspace_id", workspaceId)
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Supabase error: ${error.message}`);

    if (data && data.length > 0) {
      allRows.push(...(data as CrmVendaRow[]));
      from += PAGE_SIZE;
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allRows;
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

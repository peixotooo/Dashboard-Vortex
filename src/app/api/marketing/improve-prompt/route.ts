import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { runSpecialist } from "@/lib/agent/claude-client";
import { loadProjectContext } from "@/lib/agent/memory";
import {
  DEFAULT_PROVIDER_CONFIG,
  type ProviderConfig,
} from "@/lib/agent/llm-provider";

export const maxDuration = 120;

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

const CATEGORY_TO_AGENT: Record<string, string> = {
  campanha: "paid-ads",
  conteudo: "copywriting",
  social: "social-content",
  email: "cold-email",
  seo: "seo-audit",
  lancamento: "launch-strategy",
  evento: "coordenador",
  geral: "coordenador",
};

// POST /api/marketing/improve-prompt
export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const body = await request.json();
    const { title, description, category, start_date, end_date } = body as {
      title: string;
      description: string;
      category: string;
      start_date: string;
      end_date: string;
    };

    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    // Load provider config
    let providerConfig: ProviderConfig = DEFAULT_PROVIDER_CONFIG;
    try {
      const { data: configDoc } = await supabase
        .from("agent_documents")
        .select("content")
        .eq("workspace_id", workspaceId)
        .eq("doc_type", "provider_config")
        .single();
      if (configDoc?.content) {
        providerConfig = JSON.parse(configDoc.content);
      }
    } catch {
      // Keep default
    }

    // Load project context for business context
    const projectContext = await loadProjectContext(supabase, workspaceId);

    const agentSlug = CATEGORY_TO_AGENT[category] || "coordenador";

    const task = `Voce e um especialista em marketing. Melhore a seguinte ideia de acao de marketing, tornando-a mais especifica, acionavel e criativa.

Titulo: ${title}
Descricao: ${description || "(sem descricao ainda)"}
Categoria: ${category}
Periodo: ${start_date} a ${end_date}

IMPORTANTE:
- Retorne APENAS o texto melhorado da descricao, sem explicacoes adicionais
- Mantenha o idioma portugues
- Seja especifico com metricas, canais, formatos e acoes concretas
- Considere o periodo informado para sugerir timing adequado
- Inclua sugestoes de KPIs para medir resultado`;

    const result = await runSpecialist({
      agentSlug,
      task,
      complexity: "basic",
      accountId: "marketing-planning",
      accountContext: {
        account_name: "Marketing Planning",
        account_id: "",
        currency: "BRL",
        timezone: "America/Sao_Paulo",
      },
      workspaceId,
      supabase,
      projectContext: projectContext || undefined,
      maxLoops: 1,
      maxTokens: 2048,
      providerConfig,
    });

    return NextResponse.json({
      improved_text: result.text,
      agent_name: result.agentName,
      agent_slug: agentSlug,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

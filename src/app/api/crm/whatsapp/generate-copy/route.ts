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
        getAll() { return request.cookies.getAll(); },
        setAll() {},
      },
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const body = await request.json();
    const { campaignName, templateBody, variables, userPrompt } = body as {
      campaignName: string;
      templateBody: string;
      variables: string[];
      userPrompt: string;
    };

    if (!templateBody || !variables || variables.length === 0) {
      return NextResponse.json({ error: "templateBody and variables are required" }, { status: 400 });
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

    const projectContext = await loadProjectContext(supabase, workspaceId);

    const task = `Voce e uma copywriter especialista em WhatsApp Marketing. Preciso que voce sugira valores curtos e persuasivos para as variaveis de um template WhatsApp.

Nome da campanha: ${campaignName || "(sem nome)"}
Template original: ${templateBody}
Variaveis a preencher: ${variables.join(", ")}
${userPrompt ? `\nContexto do usuario: ${userPrompt}` : ""}

REGRAS:
- Retorne APENAS um JSON valido com os valores sugeridos
- Formato: ${JSON.stringify(Object.fromEntries(variables.map(v => [v, "valor"])))}
- Cada valor deve ter no maximo 50 caracteres
- Seja direto, persuasivo e adequado para WhatsApp
- Use portugues brasileiro
- Nao inclua explicacoes, apenas o JSON`;

    const result = await runSpecialist({
      agentSlug: "copywriting",
      task,
      complexity: "basic",
      accountId: "whatsapp-copy",
      accountContext: {
        account_name: "WhatsApp Campaign Copy",
        account_id: "",
        currency: "BRL",
        timezone: "America/Sao_Paulo",
      },
      workspaceId,
      supabase,
      projectContext: projectContext || undefined,
      maxLoops: 1,
      maxTokens: 1024,
      providerConfig,
    });

    // Try to parse JSON from the response
    let values: Record<string, string> = {};
    try {
      // Extract JSON from potential markdown code blocks
      const text = result.text.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        values = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // If parsing fails, return the raw text for the user to use manually
      return NextResponse.json({ values: {}, rawText: result.text });
    }

    return NextResponse.json({ values });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

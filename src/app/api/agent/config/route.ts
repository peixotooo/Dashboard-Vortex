import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  getWorkspaceAdminContext,
  getWorkspaceContext,
  handleAuthError,
  AuthError,
} from "@/lib/api-auth";
import { loadDocument, upsertDocument, loadAgentDocument, upsertAgentDocument } from "@/lib/agent/memory";
import { readLimitedJson } from "@/lib/security/webhook-request";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

// GET /api/agent/config?doc_type=soul  (or omit for all 3)
export async function GET(request: NextRequest) {
  try {
    const requestUrl = new URL(request.url);
    const docType = requestUrl.searchParams.get("doc_type") as string | null;
    const { workspaceId } =
      docType === "provider_config"
        ? await getWorkspaceAdminContext(request)
        : await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const accountId = requestUrl.searchParams.get("account_id") || "";
    const agentId = requestUrl.searchParams.get("agent_id");
    const validDocTypes = ["soul", "agent_rules", "user_profile", "project_context", "provider_config"] as const;

    // Team agent mode — only soul + agent_rules
    if (agentId) {
      if (docType) {
        if (docType !== "soul" && docType !== "agent_rules") {
          return NextResponse.json({ error: "Invalid doc_type for agent" }, { status: 400 });
        }
        const doc = await loadAgentDocument(supabase, workspaceId, agentId, docType);
        return NextResponse.json({ document: doc });
      }
      const [soul, agentRules] = await Promise.all([
        loadAgentDocument(supabase, workspaceId, agentId, "soul"),
        loadAgentDocument(supabase, workspaceId, agentId, "agent_rules"),
      ]);
      return NextResponse.json({ soul, agent_rules: agentRules });
    }

    if (docType) {
      if (!validDocTypes.includes(docType as typeof validDocTypes[number])) {
        return NextResponse.json({ error: "Invalid doc_type" }, { status: 400 });
      }
      // project_context and provider_config are workspace-global (no account_id)
      if (docType === "project_context") {
        const { loadProjectContext } = await import("@/lib/agent/memory");
        const content = await loadProjectContext(supabase, workspaceId);
        return NextResponse.json({ document: content ? { content, doc_type: "project_context" } : null });
      }
      if (docType === "provider_config") {
        const { data: doc } = await supabase
          .from("agent_documents")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("doc_type", "provider_config")
          .single();
        return NextResponse.json({ document: doc || null });
      }
      const doc = await loadDocument(supabase, workspaceId, accountId || "", docType as "soul" | "agent_rules" | "user_profile");
      return NextResponse.json({ document: doc });
    }

    // Load all main documents in parallel
    const { loadProjectContext } = await import("@/lib/agent/memory");
    const [soul, agentRules, userProfile, projectContext] = await Promise.all([
      loadDocument(supabase, workspaceId, accountId || "", "soul"),
      loadDocument(supabase, workspaceId, accountId || "", "agent_rules"),
      loadDocument(supabase, workspaceId, accountId || "", "user_profile"),
      loadProjectContext(supabase, workspaceId),
    ]);

    return NextResponse.json({
      soul,
      agent_rules: agentRules,
      user_profile: userProfile,
      project_context: projectContext ? { content: projectContext, doc_type: "project_context" } : null,
    });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/agent/config  { doc_type, content }
export async function PUT(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const parsed = await readLimitedJson(request, 256 * 1024);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const { doc_type, content, agent_id } = parsed.value as {
      doc_type?: unknown;
      content?: unknown;
      agent_id?: unknown;
    };

    if (
      typeof doc_type !== "string" ||
      typeof content !== "string" ||
      content.length > 200_000 ||
      (agent_id !== undefined &&
        (typeof agent_id !== "string" || !UUID_RE.test(agent_id)))
    ) {
      return NextResponse.json({ error: "doc_type and content are required" }, { status: 400 });
    }

    // Team agent document save
    if (agent_id) {
      if (doc_type !== "soul" && doc_type !== "agent_rules") {
        return NextResponse.json({ error: "Invalid doc_type for agent" }, { status: 400 });
      }
      const doc = await upsertAgentDocument(supabase, workspaceId, agent_id, doc_type as "soul" | "agent_rules", content);
      return NextResponse.json({ document: doc });
    }

    const validTypes = ["soul", "agent_rules", "user_profile", "project_context", "provider_config"] as const;
    type ValidDocType = typeof validTypes[number];
    if (!validTypes.includes(doc_type as ValidDocType)) {
      return NextResponse.json({ error: "Invalid doc_type" }, { status: 400 });
    }

    // provider_config: workspace-global upsert
    if (doc_type === "provider_config") {
      await getWorkspaceAdminContext(request);
      try {
        const providerConfig = JSON.parse(content) as {
          provider?: unknown;
          allowedModels?: unknown;
        };
        if (
          (providerConfig.provider !== "anthropic" &&
            providerConfig.provider !== "openrouter") ||
          (providerConfig.allowedModels !== undefined &&
            (!Array.isArray(providerConfig.allowedModels) ||
              providerConfig.allowedModels.length > 100 ||
              providerConfig.allowedModels.some(
                (model) =>
                  typeof model !== "string" ||
                  !/^[a-z0-9._*:/-]{1,160}$/i.test(model)
              )))
        ) {
          return NextResponse.json(
            { error: "Invalid provider_config" },
            { status: 400 }
          );
        }
      } catch {
        return NextResponse.json(
          { error: "Invalid provider_config" },
          { status: 400 }
        );
      }
      const { data: existing } = await supabase
        .from("agent_documents")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("doc_type", "provider_config")
        .single();

      if (existing) {
        const { data: doc } = await supabase
          .from("agent_documents")
          .update({ content, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
          .select()
          .single();
        return NextResponse.json({ document: doc });
      } else {
        const { data: doc } = await supabase
          .from("agent_documents")
          .insert({
            workspace_id: workspaceId,
            doc_type: "provider_config",
            content,
          })
          .select()
          .single();
        return NextResponse.json({ document: doc });
      }
    }

    const doc = await upsertDocument(supabase, workspaceId, null, doc_type as "soul" | "agent_rules" | "user_profile" | "project_context", content);
    return NextResponse.json({ document: doc });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

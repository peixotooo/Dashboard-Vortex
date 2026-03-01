import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { loadDocument, upsertDocument, loadAgentDocument, upsertAgentDocument } from "@/lib/agent/memory";

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
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const accountId = new URL(request.url).searchParams.get("account_id") || "";
    const docType = new URL(request.url).searchParams.get("doc_type") as string | null;
    const agentId = new URL(request.url).searchParams.get("agent_id");
    const validDocTypes = ["soul", "agent_rules", "user_profile", "project_context"] as const;

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
      // project_context is workspace-global (no account_id)
      if (docType === "project_context") {
        const { loadProjectContext } = await import("@/lib/agent/memory");
        const content = await loadProjectContext(supabase, workspaceId);
        return NextResponse.json({ document: content ? { content, doc_type: "project_context" } : null });
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
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/agent/config  { doc_type, content }
export async function PUT(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const body = await request.json();
    const { doc_type, content, agent_id } = body as { doc_type: string; content: string; agent_id?: string };

    if (!doc_type || content === undefined) {
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

    const validTypes = ["soul", "agent_rules", "user_profile", "project_context"] as const;
    type ValidDocType = typeof validTypes[number];
    if (!validTypes.includes(doc_type as ValidDocType)) {
      return NextResponse.json({ error: "Invalid doc_type" }, { status: 400 });
    }

    const doc = await upsertDocument(supabase, workspaceId, null, doc_type as ValidDocType, content);
    return NextResponse.json({ document: doc });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export const maxDuration = 300;
import {
  createAgentStream,
  type AgentMessage,
} from "@/lib/agent/claude-client";
import { type AccountContext } from "@/lib/agent/system-prompt";
import {
  DEFAULT_PROVIDER_CONFIG,
  type ProviderConfig,
} from "@/lib/agent/llm-provider";
import {
  loadCoreMemories,
  formatMemoriesForPrompt,
  createConversation,
  saveMessage,
  loadDocument,
  seedDefaultDocuments,
  getAgent,
  loadAgentDocument,
  loadProjectContext,
} from "@/lib/agent/memory";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";
import { setContextToken } from "@/lib/meta-api";

export async function POST(request: NextRequest) {
  try {
    // Try auth — falls back to env token
    let accessToken: string | null = null;
    let workspaceId: string | null = null;
    let userId: string | null = null;

    // Create Supabase client from request cookies
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll() {
            // Read-only in API routes
          },
        },
      }
    );

    try {
      const ctx = await getAuthenticatedContext(request);
      accessToken = ctx.accessToken;
      workspaceId = ctx.workspaceId;
      userId = ctx.userId;
    } catch {
      // Will use META_ACCESS_TOKEN from env
    }

    if (accessToken) {
      setContextToken(accessToken);
    }

    const body = await request.json();
    const {
      message,
      history = [],
      accountId,
      accountContext,
      conversationId: incomingConversationId,
      agentId,
      attachments,
    }: {
      message: string;
      history: AgentMessage[];
      accountId: string;
      accountContext: AccountContext;
      conversationId?: string;
      agentId?: string;
      attachments?: Array<{ filename: string; image_hash: string; image_url?: string }>;
    } = body;

    // Enrich message with attachment context (text part)
    let enrichedMessage = message;
    if (attachments && attachments.length > 0) {
      const list = attachments
        .map((a) => `- ${a.filename} (image_hash: "${a.image_hash}")`)
        .join("\n");
      enrichedMessage = `${message}\n\n[CRIATIVOS ANEXADOS NESTA CONVERSA — já enviados para a conta Meta, prontos para uso]\n${list}\n\nIMPORTANTE: Use EXATAMENTE estes image_hashes ao criar criativos. NAO chame list_media_gallery — as imagens já estão disponíveis acima.`;
    }

    if (!message || !accountId) {
      return new Response(
        JSON.stringify({ error: "message and accountId are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({
          error:
            "Nenhuma API key configurada (ANTHROPIC_API_KEY ou OPENROUTER_API_KEY).",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Load provider config from workspace settings
    let providerConfig: ProviderConfig = DEFAULT_PROVIDER_CONFIG;

    // Load core memories and agent documents in parallel
    let coreMemories: string | undefined;
    let soulContent: string | undefined;
    let agentRulesContent: string | undefined;
    let userProfileContent: string | undefined;
    let agentSlug: string | undefined;
    let projectContextContent: string | undefined;

    if (workspaceId) {
      try {
        // Seed default documents on first use (idempotent)
        await seedDefaultDocuments(supabase, workspaceId);

        // Load provider config
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
          // Keep default (anthropic)
        }

        // Load project context (shared by ALL agents)
        const projectCtx = await loadProjectContext(supabase, workspaceId);
        if (projectCtx) projectContextContent = projectCtx;

        if (agentId) {
          // Team agent — load agent-specific documents
          const agent = await getAgent(supabase, agentId);
          if (agent) {
            agentSlug = agent.slug;
            const [soul, rules] = await Promise.all([
              loadAgentDocument(supabase, workspaceId, agentId, "soul"),
              loadAgentDocument(supabase, workspaceId, agentId, "agent_rules"),
            ]);
            soulContent = soul?.content;
            agentRulesContent = rules?.content;
          }
        } else {
          // Default Vortex agent — load workspace-global documents
          const [memories, soul, rules, profile] = await Promise.all([
            loadCoreMemories(supabase, workspaceId, accountId),
            loadDocument(supabase, workspaceId, accountId, "soul"),
            loadDocument(supabase, workspaceId, accountId, "agent_rules"),
            loadDocument(supabase, workspaceId, accountId, "user_profile"),
          ]);

          if (memories.length > 0) {
            coreMemories = formatMemoriesForPrompt(memories);
          }
          soulContent = soul?.content;
          agentRulesContent = rules?.content;
          userProfileContent = profile?.content;
        }
      } catch {
        // Continue with defaults if loading fails
      }
    }

    // Create or continue conversation
    let activeConversationId = incomingConversationId || undefined;
    if (!activeConversationId && workspaceId && userId) {
      try {
        const conv = await createConversation(
          supabase,
          workspaceId,
          accountId,
          userId,
          message.slice(0, 100),
          agentId
        );
        activeConversationId = conv.id;
      } catch {
        // Continue without conversation persistence
      }
    }

    // Save user message
    if (activeConversationId) {
      try {
        await saveMessage(supabase, activeConversationId, "user", message);
      } catch {
        // Don't fail the request if message save fails
      }
    }

    // Extract image URLs for Claude vision
    const imageUrls = attachments
      ?.filter((a) => a.image_url)
      .map((a) => a.image_url!);

    // Build structured image attachments for specialist forwarding
    const readyAttachments = attachments
      ?.filter((a) => a.image_hash)
      .map((a) => ({
        filename: a.filename,
        image_hash: a.image_hash,
        image_url: a.image_url,
      }));

    const stream = createAgentStream({
      message: enrichedMessage,
      history,
      accountId,
      accountContext: accountContext || {
        account_name: "Conta Meta",
        account_id: accountId,
        currency: "BRL",
        timezone: "America/Sao_Paulo",
      },
      workspaceId: workspaceId || undefined,
      coreMemories,
      supabase,
      conversationId: activeConversationId,
      soulContent,
      agentRulesContent,
      userProfileContent,
      agentId,
      agentSlug,
      projectContext: projectContextContent,
      imageUrls: imageUrls && imageUrls.length > 0 ? imageUrls : undefined,
      imageAttachments: readyAttachments && readyAttachments.length > 0 ? readyAttachments : undefined,
      providerConfig,
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

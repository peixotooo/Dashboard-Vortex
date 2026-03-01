import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  createAgentStream,
  type AgentMessage,
} from "@/lib/agent/claude-client";
import { type AccountContext } from "@/lib/agent/system-prompt";
import {
  loadCoreMemories,
  formatMemoriesForPrompt,
  createConversation,
  saveMessage,
  loadDocument,
  seedDefaultDocuments,
  getAgent,
  loadAgentDocument,
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
    }: {
      message: string;
      history: AgentMessage[];
      accountId: string;
      accountContext: AccountContext;
      conversationId?: string;
      agentId?: string;
    } = body;

    if (!message || !accountId) {
      return new Response(
        JSON.stringify({ error: "message and accountId are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({
          error:
            "ANTHROPIC_API_KEY não configurada. Adicione no .env.local para usar o agente.",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Load core memories and agent documents in parallel
    let coreMemories: string | undefined;
    let soulContent: string | undefined;
    let agentRulesContent: string | undefined;
    let userProfileContent: string | undefined;
    let agentSlug: string | undefined;

    if (workspaceId) {
      try {
        // Seed default documents on first use (idempotent)
        await seedDefaultDocuments(supabase, workspaceId);

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
          message.slice(0, 100)
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

    const stream = createAgentStream({
      message,
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

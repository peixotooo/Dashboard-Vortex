import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAgentStream, type AgentMessage } from "@/lib/agent/claude-client";
import { type AccountContext } from "@/lib/agent/system-prompt";
import {
  loadCoreMemories,
  formatMemoriesForPrompt,
  createConversation,
  saveMessage,
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
    }: {
      message: string;
      history: AgentMessage[];
      accountId: string;
      accountContext: AccountContext;
      conversationId?: string;
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

    // Load core memories for this account
    let coreMemories: string | undefined;
    if (workspaceId) {
      try {
        const memories = await loadCoreMemories(
          supabase,
          workspaceId,
          accountId
        );
        if (memories.length > 0) {
          coreMemories = formatMemoriesForPrompt(memories);
        }
      } catch {
        // Continue without memories if loading fails
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

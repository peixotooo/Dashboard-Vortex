import { NextRequest } from "next/server";
import { createAgentStream, type AgentMessage } from "@/lib/agent/claude-client";
import { type AccountContext } from "@/lib/agent/system-prompt";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";
import { setContextToken } from "@/lib/meta-api";

export async function POST(request: NextRequest) {
  try {
    // Try auth — falls back to env token
    let accessToken: string | null = null;
    try {
      const ctx = await getAuthenticatedContext(request);
      accessToken = ctx.accessToken;
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
    }: {
      message: string;
      history: AgentMessage[];
      accountId: string;
      accountContext: AccountContext;
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

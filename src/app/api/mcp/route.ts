import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/mcp-client";
import { getWorkspaceAdminContext, handleAuthError } from "@/lib/api-auth";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
} from "@/lib/security/rate-limit";
import { readLimitedJson } from "@/lib/security/webhook-request";

const MAX_BODY_BYTES = 32 * 1024;
const DEFAULT_READ_ONLY_TOOLS = new Set([
  "get_ad_accounts",
  "health_check",
  "get_capabilities",
  "list_campaigns",
  "list_ad_sets",
  "list_ads",
  "get_campaign",
  "get_insights",
  "compare_performance",
  "get_campaign_performance",
  "get_attribution_data",
  "list_audiences",
  "estimate_audience_size",
  "get_audience_insights",
  "list_creatives",
  "preview_ad",
  "get_creative_performance",
  "get_token_info",
  "validate_token",
]);

function configuredSet(name: string): Set<string> {
  return new Set(
    (process.env[name] || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

export async function POST(request: NextRequest) {
  try {
    const { userId, workspaceId } = await getWorkspaceAdminContext(request);

    if (process.env.ENABLE_META_MCP_API !== "true") {
      return NextResponse.json(
        { error: "MCP API is disabled" },
        { status: 403 }
      );
    }

    const allowedWorkspaces = configuredSet("META_MCP_ALLOWED_WORKSPACE_IDS");
    if (!allowedWorkspaces.has(workspaceId)) {
      return NextResponse.json(
        { error: "MCP is not enabled for this workspace" },
        { status: 403 }
      );
    }

    const rateLimit = await consumeSecurityRateLimit({
      scope: "meta:mcp:admin",
      key: `${workspaceId}:${userId}:${getRequestClientIp(request)}`,
      limit: 30,
      windowSeconds: 60,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const parsedBody = await readLimitedJson(request, MAX_BODY_BYTES);
    if (!parsedBody.ok) {
      return NextResponse.json(
        { error: parsedBody.error },
        { status: parsedBody.status }
      );
    }
    const body = parsedBody.value as {
      tool?: unknown;
      args?: unknown;
    };
    const tool = typeof body.tool === "string" ? body.tool.trim() : "";
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};

    if (!/^[a-z0-9_]{1,80}$/.test(tool)) {
      return NextResponse.json(
        { error: "Missing or invalid 'tool' parameter" },
        { status: 400 }
      );
    }

    const explicitlyAllowedTools = configuredSet("META_MCP_ALLOWED_TOOLS");
    const allowedTools =
      explicitlyAllowedTools.size > 0
        ? explicitlyAllowedTools
        : DEFAULT_READ_ONLY_TOOLS;
    if (!allowedTools.has(tool)) {
      return NextResponse.json(
        { error: "MCP tool is not allowed" },
        { status: 403 }
      );
    }

    const result = await callTool(tool, args);
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}

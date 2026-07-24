import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { updateMemoryValue } from "@/lib/agent/memory";
import {
  AuthError,
  getWorkspaceContext,
  handleAuthError,
} from "@/lib/api-auth";
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

// PUT /api/agent/memories/[id]  { value: "new value" }
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }
    const parsed = await readLimitedJson(request, 32 * 1024);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const value =
      parsed.value &&
      typeof parsed.value === "object" &&
      !Array.isArray(parsed.value) &&
      typeof (parsed.value as Record<string, unknown>).value === "string"
        ? (parsed.value as Record<string, string>).value.trim()
        : "";

    if (!value || value.length > 20_000) {
      return NextResponse.json({ error: "value is required" }, { status: 400 });
    }

    const memory = await updateMemoryValue(supabase, id, value, workspaceId);
    return NextResponse.json({ memory });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[agent/memories/:id]", message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  createGroupPool,
  listGroupPools,
  slugifyGroupPool,
} from "@/lib/whatsapp/group-pools";

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

async function authenticate(request: NextRequest) {
  const supabase = createSupabase(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", status: 401 as const };

  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId) return { error: "Workspace not specified", status: 400 as const };

  return { user, workspaceId };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const admin = createAdminClient();
    const pools = await listGroupPools(admin, auth.workspaceId, request.nextUrl.origin);

    return NextResponse.json({ pools });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const name = String(body.name || "").trim();
    const slug = slugifyGroupPool(String(body.slug || name));
    const matchPattern = String(body.matchPattern || body.match_pattern || name).trim();
    const capacity = Number.parseInt(String(body.capacity || 1024), 10);
    const nearFullThreshold = Number.parseInt(
      String(body.nearFullThreshold || body.near_full_threshold || 950),
      10
    );

    if (!name || !slug) {
      return NextResponse.json({ error: "Nome e slug sao obrigatorios" }, { status: 400 });
    }
    if (!Number.isFinite(capacity) || capacity <= 0) {
      return NextResponse.json({ error: "Capacidade invalida" }, { status: 400 });
    }
    if (
      !Number.isFinite(nearFullThreshold) ||
      nearFullThreshold <= 0 ||
      nearFullThreshold > capacity
    ) {
      return NextResponse.json({ error: "Limite de alerta invalido" }, { status: 400 });
    }

    const admin = createAdminClient();
    await createGroupPool(admin, auth.workspaceId, {
      name,
      slug,
      matchPattern: matchPattern || null,
      capacity,
      nearFullThreshold,
      active: true,
      groupOverrides: {},
    });
    const pools = await listGroupPools(admin, auth.workspaceId, request.nextUrl.origin);

    return NextResponse.json({ pools });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

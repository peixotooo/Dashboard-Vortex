import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  createGroupPool,
  listGroupPools,
  slugifyGroupPool,
} from "@/lib/whatsapp/group-pools";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();
    const pools = await listGroupPools(admin, workspaceId, request.nextUrl.origin);

    return NextResponse.json({ pools });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

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
    await createGroupPool(admin, workspaceId, {
      name,
      slug,
      matchPattern: matchPattern || null,
      capacity,
      nearFullThreshold,
      active: true,
      groupOverrides: {},
    });
    const pools = await listGroupPools(admin, workspaceId, request.nextUrl.origin);

    return NextResponse.json({ pools });
  } catch (error) {
    return handleAuthError(error);
  }
}

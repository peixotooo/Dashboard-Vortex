import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { importMissingCartsFromVnda } from "@/lib/cart-recovery/vnda-import";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const body = await request.json().catch(() => ({}));
    const hours = Math.max(1, Math.min(168, Number(body.hours) || 48));

    const stats = await importMissingCartsFromVnda({
      admin: createAdminClient(),
      workspaceId,
      hours,
      maxPages: 5,
      perPage: 100,
      rateLimitMs: 150,
    });

    return NextResponse.json({
      ok: true,
      window_hours: hours,
      ...stats,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

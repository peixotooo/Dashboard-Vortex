import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { buildCartRecoveryJourneyPayload } from "@/lib/cart-recovery/journey-service";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const payload = await buildCartRecoveryJourneyPayload({
      admin: createAdminClient(),
      workspaceId,
      limit: Number(request.nextUrl.searchParams.get("limit") || 60),
      status: request.nextUrl.searchParams.get("status"),
      preferPersisted: true,
    });
    return NextResponse.json(payload);
  } catch (error) {
    return handleAuthError(error);
  }
}

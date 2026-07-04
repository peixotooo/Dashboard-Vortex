import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getBanditStats } from "@/lib/coupons/bandit";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const stats = await getBanditStats(workspaceId);
    return NextResponse.json({ stats });
  } catch (error) {
    return handleAuthError(error);
  }
}

// POST = force recompute now
export async function POST(request: NextRequest) {
  try {
    await getWorkspaceContext(request);
    return NextResponse.json({
      queued: true,
      message:
        "A recomputação do bandit roda pelo worker no ciclo de atribuição de cupons.",
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getControladoriaContext, handleAuthError } from "@/lib/api-auth";
import { readAutoRevenueConfig, writeAutoRevenueConfig, syncAutoRevenue } from "@/lib/controladoria/auto-revenue";

export const maxDuration = 120;

// GET — config atual + resultado da última rodada
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getControladoriaContext(request);
    const { config } = await readAutoRevenueConfig(workspaceId);
    return NextResponse.json({ config });
  } catch (err) {
    return handleAuthError(err);
  }
}

// PATCH — liga/desliga e data de início { enabled?, start_date? }
export async function PATCH(request: NextRequest) {
  try {
    const { workspaceId } = await getControladoriaContext(request);
    const body = await request.json();
    const patch: Record<string, unknown> = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.start_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) patch.start_date = body.start_date;
    const config = await writeAutoRevenueConfig(workspaceId, patch);
    return NextResponse.json({ config });
  } catch (err) {
    return handleAuthError(err);
  }
}

// POST — "Sincronizar agora" (roda mesmo desativada, por ação explícita do usuário)
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getControladoriaContext(request);
    const result = await syncAutoRevenue(workspaceId, { force: true });
    return NextResponse.json(result);
  } catch (err) {
    return handleAuthError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { captureGroupSnapshots } from "@/lib/whatsapp/group-snapshot";

// group-metadata por grupo com throttle — pode levar mais de 60s.
export const maxDuration = 300;

// POST /api/whatsapp-groups/member-snapshot — captura on-demand do dia.
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();
    const result = await captureGroupSnapshots(admin, workspaceId, { source: "manual" });

    if (!result.configured) {
      return NextResponse.json(
        { error: "W-API não configurada. Conecte em WhatsApp Grupos." },
        { status: 400 }
      );
    }
    if (!result.connected) {
      return NextResponse.json(
        { error: "W-API desconectada. Reconecte a instância em WhatsApp Grupos." },
        { status: 400 }
      );
    }
    if (result.groupsCaptured === 0 && result.errors.length > 0) {
      return NextResponse.json(
        {
          error: `Não foi possível capturar os grupos: ${result.errors[0].error}`,
          result,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}

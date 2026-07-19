import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/pricing/supabase";
import { isMissingPspSchema, refreshPspInventorySnapshot } from "@/lib/psp/inventory";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await refreshPspInventorySnapshot(createAdminClient(), auth.workspaceId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (isMissingPspSchema(error)) {
      return NextResponse.json(
        { error: "Rode a migration 142 antes de atualizar o estoque." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao consultar o Eccosys" },
      { status: 502 }
    );
  }
}

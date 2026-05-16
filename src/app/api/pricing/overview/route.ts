// GET /api/pricing/overview — KPIs + matriz idade×margem + matriz 3×3
// trava×desconto. Usado pela tela /pricing/visao-geral.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/pricing/supabase";
import { computeOverview } from "@/lib/pricing/analytics";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const overview = await computeOverview(auth.supabase, auth.workspaceId);
    return NextResponse.json(overview);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

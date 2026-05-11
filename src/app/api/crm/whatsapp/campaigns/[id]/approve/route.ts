// src/app/api/crm/whatsapp/campaigns/[id]/approve/route.ts
//
// Aprova uma campanha em pending_approval. Transiciona pra:
//   - scheduled (se scheduled_at no futuro) → cron envia na data
//   - queued (caso contrário) → cron pega no próximo tick
//
// Quem submeteu pra aprovação não pode aprovar a própria campanha.

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll() {},
      },
    }
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const { id } = await params;
    const admin = createAdminClient();

    const { data: campaign } = await admin
      .from("wa_campaigns")
      .select("id, status, scheduled_at, submitted_by")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    if (campaign.status !== "pending_approval") {
      return NextResponse.json(
        { error: "Essa campanha não está pendente de aprovação." },
        { status: 400 }
      );
    }
    if (campaign.submitted_by && campaign.submitted_by === user.id) {
      return NextResponse.json(
        {
          error:
            "Quem submeteu pra aprovação não pode aprovar a própria campanha. Peça pra outro membro do time.",
        },
        { status: 403 }
      );
    }

    // Decide próximo status: scheduled se data futura, senão queued.
    const nextStatus =
      campaign.scheduled_at && new Date(campaign.scheduled_at) > new Date()
        ? "scheduled"
        : "queued";

    const now = new Date().toISOString();
    const { error: upErr } = await admin
      .from("wa_campaigns")
      .update({
        status: nextStatus,
        approved_by: user.id,
        approved_at: now,
        ...(nextStatus === "queued" ? { started_at: now } : {}),
      })
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .eq("status", "pending_approval");
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, status: nextStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

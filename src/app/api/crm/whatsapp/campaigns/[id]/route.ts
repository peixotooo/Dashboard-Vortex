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

export async function GET(
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
      .select("*, wa_templates(id, meta_id, name, language, category, status, components, synced_at)")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    return NextResponse.json({ campaign });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH = cancel a campaign
export async function PATCH(
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
    const body = await request.json();

    const admin = createAdminClient();

    // Verify campaign exists and belongs to workspace
    const { data: campaign } = await admin
      .from("wa_campaigns")
      .select("id, status, started_at")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    if (body.action === "cancel") {
      const cancellableStatuses = ["scheduled", "queued", "draft"];
      if (!cancellableStatuses.includes(campaign.status)) {
        return NextResponse.json(
          { error: `Campanha com status "${campaign.status}" nao pode ser cancelada` },
          { status: 400 }
        );
      }

      const { data: updated, error: updateErr } = await admin
        .from("wa_campaigns")
        .update({ status: "cancelled" })
        .eq("id", id)
        .select()
        .single();

      if (updateErr) throw new Error(updateErr.message);
      return NextResponse.json({ campaign: updated });
    }

    if (body.action === "reschedule") {
      const reschedulableStatuses = ["scheduled", "queued", "draft", "cancelled"];
      if (!reschedulableStatuses.includes(campaign.status)) {
        return NextResponse.json(
          { error: `Campanha com status "${campaign.status}" nao pode ser reagendada` },
          { status: 400 }
        );
      }

      const raw = body.scheduled_at;
      if (!raw || typeof raw !== "string") {
        return NextResponse.json(
          { error: "scheduled_at e obrigatorio (ISO timestamp)" },
          { status: 400 }
        );
      }
      const when = new Date(raw);
      if (Number.isNaN(when.getTime())) {
        return NextResponse.json({ error: "scheduled_at invalido" }, { status: 400 });
      }
      if (when.getTime() <= Date.now()) {
        return NextResponse.json(
          { error: "scheduled_at deve ser no futuro" },
          { status: 400 }
        );
      }

      const updates: Record<string, unknown> = {
        status: "scheduled",
        scheduled_at: when.toISOString(),
      };
      // Reset started_at if it was set on cancelled/queued — campaign hasn't dispatched
      if (!campaign.started_at || campaign.status !== "sending") {
        updates.started_at = null;
      }

      const { data: updated, error: updateErr } = await admin
        .from("wa_campaigns")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (updateErr) throw new Error(updateErr.message);
      return NextResponse.json({ campaign: updated });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

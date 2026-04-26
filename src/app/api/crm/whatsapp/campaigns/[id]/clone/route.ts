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

// GET = preview how many messages would be re-sent (by status group)
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
      .select("id")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const { data: msgs } = await admin
      .from("wa_messages")
      .select("status")
      .eq("campaign_id", id);

    const counts = { total: 0, delivered: 0, read: 0, sent: 0, failed: 0, queued: 0, other: 0 };
    for (const m of msgs || []) {
      counts.total++;
      if (m.status === "delivered") counts.delivered++;
      else if (m.status === "read") counts.read++;
      else if (m.status === "sent") counts.sent++;
      else if (m.status === "failed") counts.failed++;
      else if (m.status === "queued") counts.queued++;
      else counts.other++;
    }

    return NextResponse.json({
      counts,
      undelivered: counts.total - counts.delivered - counts.read,
      all: counts.total,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST = clone the campaign (optionally only undelivered) into a new scheduled campaign
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
    const body = await request.json();
    const scheduledAtRaw: string | undefined = body?.scheduled_at;
    const scope: "undelivered" | "all" = body?.scope === "all" ? "all" : "undelivered";
    const newName: string | undefined = body?.name;

    if (!scheduledAtRaw) {
      return NextResponse.json({ error: "scheduled_at e obrigatorio" }, { status: 400 });
    }
    const when = new Date(scheduledAtRaw);
    if (Number.isNaN(when.getTime())) {
      return NextResponse.json({ error: "scheduled_at invalido" }, { status: 400 });
    }
    if (when.getTime() <= Date.now()) {
      return NextResponse.json({ error: "scheduled_at deve ser no futuro" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Source campaign
    const { data: src } = await admin
      .from("wa_campaigns")
      .select("*")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();
    if (!src) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    // Pull source messages — only those NOT already delivered/read when scope=undelivered
    let msgQuery = admin
      .from("wa_messages")
      .select("phone, contact_name, variable_values")
      .eq("campaign_id", id);
    if (scope === "undelivered") {
      msgQuery = msgQuery.not("status", "in", "(delivered,read)");
    }
    const { data: srcMsgs } = await msgQuery;

    if (!srcMsgs || srcMsgs.length === 0) {
      return NextResponse.json(
        { error: "Nao ha contatos para reenviar" },
        { status: 400 }
      );
    }

    // De-dup by phone (in case the source had duplicates across statuses)
    const seen = new Set<string>();
    const uniqueMsgs = srcMsgs.filter((m) => {
      if (seen.has(m.phone)) return false;
      seen.add(m.phone);
      return true;
    });

    const cloneName = newName?.trim()
      || `${src.name} (reenvio ${when.toLocaleDateString("pt-BR")})`;

    const { data: newCampaign, error: campErr } = await admin
      .from("wa_campaigns")
      .insert({
        workspace_id: workspaceId,
        name: cloneName,
        template_id: src.template_id,
        segment_filter: src.segment_filter || {},
        variable_values: src.variable_values || {},
        status: "scheduled",
        total_messages: uniqueMsgs.length,
        scheduled_at: when.toISOString(),
        attribution_window_days: src.attribution_window_days,
        message_cost_usd: src.message_cost_usd,
        exchange_rate: src.exchange_rate,
      })
      .select()
      .single();

    if (campErr || !newCampaign) {
      throw new Error(`Failed to create cloned campaign: ${campErr?.message}`);
    }

    // Insert wa_messages in batches
    const BATCH = 500;
    for (let i = 0; i < uniqueMsgs.length; i += BATCH) {
      const slice = uniqueMsgs.slice(i, i + BATCH).map((m) => ({
        workspace_id: workspaceId,
        campaign_id: newCampaign.id,
        phone: m.phone,
        contact_name: m.contact_name || null,
        variable_values: m.variable_values || {},
        status: "queued",
      }));
      const { error: msgErr } = await admin.from("wa_messages").insert(slice);
      if (msgErr) {
        console.error("[WA Clone] Error inserting messages batch:", msgErr.message);
      }
    }

    return NextResponse.json({
      campaign: newCampaign,
      cloned_count: uniqueMsgs.length,
      source_id: src.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

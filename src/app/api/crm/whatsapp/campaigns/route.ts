import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { filterContacts } from "@/lib/wa-compliance";

export const maxDuration = 120;

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

export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const admin = createAdminClient();
    const { data: campaigns } = await admin
      .from("wa_campaigns")
      .select("*, wa_templates(name, language)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);

    return NextResponse.json({ campaigns: campaigns || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST = create campaign + enqueue messages
export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const body = await request.json();
    const { name, templateId, segmentFilter, variableValues, contacts, scheduled_at, attribution_window_days, message_cost_usd, exchange_rate, cooldownDays, requires_approval } = body;

    if (!name || !templateId || !contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Rascunho com aprovação exige data + hora de envio definidos.
    if (requires_approval && !scheduled_at) {
      return NextResponse.json(
        {
          error:
            "Pra enviar como rascunho com aprovação, preencha data e hora de envio.",
        },
        { status: 400 }
      );
    }

    // Determine initial status based on scheduling + approval flag.
    // pending_approval: o cron whatsapp-sender só lê queued/sending/scheduled-due,
    // então campanhas pendentes ficam paradas até alguém aprovar.
    let initialStatus = "queued";
    let scheduledAtValue: string | null = null;
    if (scheduled_at) {
      const scheduledDate = new Date(scheduled_at);
      if (scheduledDate > new Date()) {
        initialStatus = "scheduled";
        scheduledAtValue = scheduledDate.toISOString();
      }
    }
    if (requires_approval) {
      initialStatus = "pending_approval";
    }

    // --- Compliance filtering ---
    const cdDays = typeof cooldownDays === "number" ? cooldownDays : 7;
    const complianceResult = await filterContacts(
      workspaceId,
      contacts as Array<{ phone: string; name?: string; variables?: Record<string, string> }>,
      cdDays
    );

    if (complianceResult.allowed.length === 0) {
      return NextResponse.json({
        error: "Todos os contatos foram excluidos pela politica de compliance",
        compliance: {
          originalCount: contacts.length,
          filteredCount: 0,
          cooldownCount: complianceResult.cooldownCount,
          blockedCount: complianceResult.blockedCount,
        },
      }, { status: 400 });
    }

    const filteredContacts = complianceResult.allowed;
    const admin = createAdminClient();

    // Create campaign
    const { data: campaign, error: campErr } = await admin
      .from("wa_campaigns")
      .insert({
        workspace_id: workspaceId,
        name,
        template_id: templateId,
        segment_filter: segmentFilter || {},
        variable_values: variableValues || {},
        status: initialStatus,
        total_messages: filteredContacts.length,
        attribution_window_days: attribution_window_days || 3,
        message_cost_usd: message_cost_usd || 0.0625,
        exchange_rate: exchange_rate || 5.50,
        ...(scheduledAtValue ? { scheduled_at: scheduledAtValue } : {}),
        ...(requires_approval
          ? {
              submitted_by: user.id,
              submitted_at: new Date().toISOString(),
            }
          : {}),
      })
      .select()
      .single();

    if (campErr || !campaign) {
      throw new Error(`Failed to create campaign: ${campErr?.message}`);
    }

    // Enqueue messages in batches of 500
    const BATCH_SIZE = 500;
    for (let i = 0; i < filteredContacts.length; i += BATCH_SIZE) {
      const batch = filteredContacts.slice(i, i + BATCH_SIZE).map((c) => ({
        workspace_id: workspaceId,
        campaign_id: campaign.id,
        phone: c.phone,
        contact_name: c.name || null,
        variable_values: c.variables || variableValues || {},
        status: "queued",
      }));

      const { error: msgErr } = await admin.from("wa_messages").insert(batch);
      if (msgErr) {
        console.error("[WA Campaign] Error inserting messages batch:", msgErr.message);
      }
    }

    return NextResponse.json({
      campaign,
      compliance: {
        originalCount: contacts.length,
        filteredCount: filteredContacts.length,
        cooldownCount: complianceResult.cooldownCount,
        blockedCount: complianceResult.blockedCount,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

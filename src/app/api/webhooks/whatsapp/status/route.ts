import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const maxDuration = 30;

// GET = Meta webhook verification (challenge)
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");

  const verifyToken = process.env.WA_WEBHOOK_VERIFY_TOKEN || "vortex_wa_verify";

  if (mode === "subscribe" && token === verifyToken) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// POST = Meta webhook status updates
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const admin = createAdminClient();

    // Meta sends: { object: "whatsapp_business_account", entry: [...] }
    const entries = body.entry || [];

    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== "messages") continue;
        const statuses = change.value?.statuses || [];

        for (const s of statuses) {
          const metaMessageId = s.id;
          const status = s.status; // sent, delivered, read, failed
          const timestamp = s.timestamp
            ? new Date(parseInt(s.timestamp) * 1000).toISOString()
            : new Date().toISOString();

          if (!metaMessageId || !status) continue;

          // Update message status
          const updates: Record<string, unknown> = { status };
          if (status === "sent") updates.sent_at = timestamp;
          if (status === "delivered") updates.delivered_at = timestamp;
          if (status === "read") updates.read_at = timestamp;
          if (status === "failed") {
            updates.error_message = s.errors?.[0]?.title || "Unknown error";
          }

          const { data: msg } = await admin
            .from("wa_messages")
            .update(updates)
            .eq("meta_message_id", metaMessageId)
            .select("campaign_id")
            .single();

          // Update campaign counters
          if (msg?.campaign_id) {
            const countField = `${status}_count`;
            if (["sent", "delivered", "read", "failed"].includes(status)) {
              const { data: camp } = await admin
                .from("wa_campaigns")
                .select(countField)
                .eq("id", msg.campaign_id)
                .single();
              if (camp) {
                const current = (camp as unknown as Record<string, number>)[countField] || 0;
                await admin
                  .from("wa_campaigns")
                  .update({ [countField]: current + 1 })
                  .eq("id", msg.campaign_id);
              }
            }
          }
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[WA Webhook]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: true }); // Always 200 to Meta
  }
}

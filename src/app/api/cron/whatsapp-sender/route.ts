import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWaConfig, sendTemplateMessage } from "@/lib/whatsapp-api";

export const maxDuration = 300;

const BATCH_SIZE = 50;
const DELAY_MS = 50; // ~20 msgs/sec, well under Meta's 80/sec limit

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    // Find active campaigns (queued, sending, or scheduled and due)
    const { data: campaigns } = await admin
      .from("wa_campaigns")
      .select("id, workspace_id, template_id, variable_values, status, scheduled_at")
      .or("status.eq.queued,status.eq.sending,and(status.eq.scheduled,scheduled_at.lte.now())")
      .limit(5);

    if (!campaigns || campaigns.length === 0) {
      return NextResponse.json({ processed: 0, message: "No active campaigns" });
    }

    let totalProcessed = 0;

    for (const campaign of campaigns) {
      // Mark as sending (from queued or scheduled)
      if (campaign.status === "queued" || campaign.status === "scheduled") {
        await admin
          .from("wa_campaigns")
          .update({ status: "sending", started_at: new Date().toISOString() })
          .eq("id", campaign.id);
      }

      // Get WA config for this workspace
      const config = await getWaConfig(campaign.workspace_id);
      if (!config) {
        console.error(`[WA Sender] No WA config for workspace ${campaign.workspace_id}`);
        await admin
          .from("wa_campaigns")
          .update({ status: "failed" })
          .eq("id", campaign.id);
        continue;
      }

      // Get template info
      const { data: template } = await admin
        .from("wa_templates")
        .select("name, language")
        .eq("id", campaign.template_id)
        .single();

      if (!template) {
        console.error(`[WA Sender] Template not found: ${campaign.template_id}`);
        await admin
          .from("wa_campaigns")
          .update({ status: "failed" })
          .eq("id", campaign.id);
        continue;
      }

      // Fetch batch of queued messages
      const { data: messages } = await admin
        .from("wa_messages")
        .select("id, phone, contact_name, variable_values")
        .eq("campaign_id", campaign.id)
        .eq("status", "queued")
        .limit(BATCH_SIZE);

      if (!messages || messages.length === 0) {
        // No more queued messages - check if campaign is done
        const { data: remaining } = await admin
          .from("wa_messages")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaign.id)
          .eq("status", "queued");

        if (!remaining || (remaining as unknown[]).length === 0) {
          await admin
            .from("wa_campaigns")
            .update({ status: "completed", completed_at: new Date().toISOString() })
            .eq("id", campaign.id);
        }
        continue;
      }

      // Send each message
      for (const msg of messages) {
        // Mark as sending
        await admin
          .from("wa_messages")
          .update({ status: "sending" })
          .eq("id", msg.id);

        // Merge campaign-level and message-level variables
        const variables = {
          ...(campaign.variable_values as Record<string, string>),
          ...(msg.variable_values as Record<string, string>),
        };

        // Replace contact-field placeholders
        if (msg.contact_name) {
          for (const [key, val] of Object.entries(variables)) {
            if (val === "{{nome}}") variables[key] = msg.contact_name;
          }
        }

        const result = await sendTemplateMessage(
          config,
          msg.phone,
          template.name,
          template.language,
          Object.keys(variables).length > 0 ? variables : undefined
        );

        if (result.messageId) {
          await admin
            .from("wa_messages")
            .update({
              status: "sent",
              meta_message_id: result.messageId,
              sent_at: new Date().toISOString(),
            })
            .eq("id", msg.id);

          // Increment sent_count
          const { data: campSent } = await admin
            .from("wa_campaigns")
            .select("sent_count")
            .eq("id", campaign.id)
            .single();
          if (campSent) {
            await admin
              .from("wa_campaigns")
              .update({ sent_count: (campSent.sent_count || 0) + 1 })
              .eq("id", campaign.id);
          }
        } else {
          await admin
            .from("wa_messages")
            .update({
              status: "failed",
              error_message: result.error || "Unknown error",
            })
            .eq("id", msg.id);

          // Increment failed_count
          const { data: camp } = await admin
            .from("wa_campaigns")
            .select("failed_count")
            .eq("id", campaign.id)
            .single();
          if (camp) {
            await admin
              .from("wa_campaigns")
              .update({ failed_count: (camp.failed_count || 0) + 1 })
              .eq("id", campaign.id);
          }
        }

        totalProcessed++;
        await sleep(DELAY_MS);
      }
    }

    return NextResponse.json({ processed: totalProcessed });
  } catch (error) {
    console.error("[WA Sender]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

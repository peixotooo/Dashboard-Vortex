import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWaConfig, sendTemplateMessage } from "@/lib/whatsapp-api";
import { getExcludedPhones } from "@/lib/wa-compliance";

export const maxDuration = 300;

const BATCH_SIZE = 200;
const PARALLEL = 10;  // micro-batch size for Meta API calls
const DELAY_MS = 50;  // between micro-batches (~20 msgs/sec per parallel slot)

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
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

      // Pre-load exclusion list once (cached with TTL in wa-compliance)
      const excludedPhones = await getExcludedPhones(campaign.workspace_id);

      // --- Separate blocked phones in-memory (no DB calls) ---
      type Msg = (typeof messages)[number];
      const toSend: Msg[] = [];
      const blockedIds: string[] = [];
      for (const msg of messages) {
        if (excludedPhones.has(msg.phone.replace(/\D/g, ""))) {
          blockedIds.push(msg.id);
        } else {
          toSend.push(msg);
        }
      }

      // --- Send in parallel micro-batches ---
      const sentResults: { id: string; messageId: string }[] = [];
      const failedIds: string[] = [];

      for (let i = 0; i < toSend.length; i += PARALLEL) {
        const chunk = toSend.slice(i, i + PARALLEL);
        const results = await Promise.allSettled(
          chunk.map(async (msg) => {
            const variables = {
              ...(campaign.variable_values as Record<string, string> | null),
              ...(msg.variable_values as Record<string, string> | null),
            };
            const hasVars = Object.keys(variables).length > 0;
            const result = await sendTemplateMessage(
              config,
              msg.phone,
              template.name,
              template.language,
              hasVars ? variables : undefined
            );
            return { id: msg.id, messageId: result.messageId, error: result.error };
          })
        );

        for (let j = 0; j < results.length; j++) {
          const r = results[j];
          if (r.status === "fulfilled" && r.value.messageId) {
            sentResults.push({ id: r.value.id, messageId: r.value.messageId });
          } else {
            const id = r.status === "fulfilled" ? r.value.id : chunk[j]?.id;
            if (id) failedIds.push(id);
          }
        }

        // Rate limit between micro-batches
        if (i + PARALLEL < toSend.length) await sleep(DELAY_MS);
      }

      // --- Batch DB updates ---

      // Blocked: 1 query
      if (blockedIds.length > 0) {
        await admin
          .from("wa_messages")
          .update({ status: "failed", error_message: "Blocked by exclusion list" })
          .in("id", blockedIds);
      }

      // Failed: 1 query
      if (failedIds.length > 0) {
        await admin
          .from("wa_messages")
          .update({ status: "failed", error_message: "send_error" })
          .in("id", failedIds);
      }

      // Sent: batch update status+sent_at (1 query) + meta_message_id in parallel chunks
      if (sentResults.length > 0) {
        const now = new Date().toISOString();

        // 1 query for common fields
        await admin
          .from("wa_messages")
          .update({ status: "sent", sent_at: now })
          .in("id", sentResults.map((r) => r.id));

        // meta_message_id needs per-message value — parallel chunks of 50
        for (let i = 0; i < sentResults.length; i += 50) {
          const chunk = sentResults.slice(i, i + 50);
          await Promise.all(
            chunk.map((r) =>
              admin
                .from("wa_messages")
                .update({ meta_message_id: r.messageId })
                .eq("id", r.id)
            )
          );
        }
      }

      const batchSent = sentResults.length;
      const batchFailed = blockedIds.length + failedIds.length;
      totalProcessed += batchSent + batchFailed;

      console.log(
        `[WA Sender] Campaign ${campaign.id}: sent=${batchSent} failed=${batchFailed} blocked=${blockedIds.length}`
      );

      // Update campaign counters once per batch
      if (batchSent > 0 || batchFailed > 0) {
        const { data: camp } = await admin
          .from("wa_campaigns")
          .select("sent_count, failed_count")
          .eq("id", campaign.id)
          .single();
        if (camp) {
          await admin
            .from("wa_campaigns")
            .update({
              sent_count: (camp.sent_count || 0) + batchSent,
              failed_count: (camp.failed_count || 0) + batchFailed,
            })
            .eq("id", campaign.id);
        }
      }
    }

    return NextResponse.json({ processed: totalProcessed });
  } catch (error) {
    console.error("[WA Sender]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

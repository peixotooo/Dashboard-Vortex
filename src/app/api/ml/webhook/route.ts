import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * ML webhook notifications.
 * Must always return 200 — ML retries aggressively on failures.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const supabase = createAdminClient();

  // Identify workspace from ml_user_id
  const mlUserId = body.user_id;
  if (!mlUserId) {
    return NextResponse.json({ ok: true });
  }

  const { data: cred } = await supabase
    .from("ml_credentials")
    .select("workspace_id")
    .eq("ml_user_id", mlUserId)
    .limit(1)
    .single();

  if (!cred) {
    // Unknown user — still return 200
    return NextResponse.json({ ok: true });
  }

  // Log the webhook
  await supabase.from("hub_logs").insert({
    workspace_id: cred.workspace_id,
    action: "webhook_received",
    entity: body.topic === "orders_v2" ? "order" : "product",
    entity_id: String(body.resource || ""),
    direction: "ml_to_hub",
    status: "ok",
    details: body,
  });

  // If it's an order notification, process async
  if (body.topic === "orders_v2" && body.resource) {
    fetch(`${req.nextUrl.origin}/api/sync/pull-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-id": cred.workspace_id,
      },
      body: JSON.stringify({ resource: body.resource }),
    }).catch(() => {
      // Fire and forget — don't block webhook response
    });
  }

  return NextResponse.json({ ok: true });
}

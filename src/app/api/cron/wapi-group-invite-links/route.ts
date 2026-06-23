import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { processPoolInviteLinkQueue } from "@/lib/whatsapp/group-pools";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const result = await processPoolInviteLinkQueue(admin, {
      limit: Number(process.env.WAPI_INVITE_LINK_QUEUE_LIMIT || 2),
      throttleMs: Number(process.env.WAPI_INVITE_LINK_QUEUE_THROTTLE_MS || 20000),
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  enqueuePoolInviteLinkJobs,
  processPoolInviteLinkQueue,
} from "@/lib/whatsapp/group-pools";

export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { workspaceId } = await getWorkspaceContext(request);

    const body = await request.json().catch(() => ({}));
    const admin = createAdminClient();
    const enqueued = await enqueuePoolInviteLinkJobs(
      admin,
      workspaceId,
      id,
      request.nextUrl.origin,
      {
        force: body.force === true,
        groupJid: typeof body.groupJid === "string" ? body.groupJid : null,
      }
    );
    const processed = await processPoolInviteLinkQueue(
      admin,
      {
        workspaceId,
        poolId: id,
        origin: request.nextUrl.origin,
        limit: body.groupJid ? 1 : 2,
        throttleMs: 20000,
      }
    );

    return NextResponse.json({
      pools: processed.pools || enqueued.pools,
      summary: {
        ...enqueued.summary,
        processed: processed.processed,
        updated: processed.updated,
        failed: processed.failed,
        retrying: processed.retrying,
        remaining: processed.remaining,
        errors: processed.errors,
      },
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

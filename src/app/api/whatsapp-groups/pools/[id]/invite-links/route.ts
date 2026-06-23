import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  enqueuePoolInviteLinkJobs,
  processPoolInviteLinkQueue,
} from "@/lib/whatsapp/group-pools";

export const maxDuration = 120;

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    }
  );
}

async function authenticate(request: NextRequest) {
  const supabase = createSupabase(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", status: 401 as const };

  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId) return { error: "Workspace not specified", status: 400 as const };

  return { user, workspaceId };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authenticate(request);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json().catch(() => ({}));
    const admin = createAdminClient();
    const enqueued = await enqueuePoolInviteLinkJobs(
      admin,
      auth.workspaceId,
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
        workspaceId: auth.workspaceId,
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
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

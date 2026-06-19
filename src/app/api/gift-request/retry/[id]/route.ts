import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { dispatchGiftRequest } from "@/lib/gift-request/dispatch";

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

// POST /api/gift-request/retry/[id]
// Reenfileira um gift_request que falhou: cria nova wa_campaign + wa_message
// com kind='gift_request', re-aplica o mapping atual do config. Útil pra
// testar de novo depois de corrigir o template ou o mapping.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createSupabase(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId)
    return NextResponse.json(
      { error: "Workspace not specified" },
      { status: 400 }
    );

  const { id } = await params;
  const admin = createAdminClient();

  const { data: gr } = await admin
    .from("gift_requests")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!gr) {
    return NextResponse.json(
      { error: "Pedido não encontrado" },
      { status: 404 }
    );
  }

  const { data: config } = await admin
    .from("gift_request_configs")
    .select("wa_template_id, wa_variable_mapping")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const result = await dispatchGiftRequest({
    admin,
    workspaceId,
    request: gr,
    templateId: config?.wa_template_id,
    variableMapping: config?.wa_variable_mapping || {},
  });

  if (!result.ok) {
    await admin
      .from("gift_requests")
      .update({
        status: "failed",
        error_message: result.error || "retry_dispatch_failed",
      })
      .eq("id", gr.id);
    return NextResponse.json(
      { error: result.error || "dispatch_failed" },
      { status: 500 }
    );
  }

  await admin
    .from("gift_requests")
    .update({
      wa_campaign_id: result.campaignId,
      wa_message_id: result.messageId,
      status: "queued",
      error_message: null,
      sent_at: null,
      delivered_at: null,
      read_at: null,
    })
    .eq("id", gr.id);

  return NextResponse.json({
    ok: true,
    campaign_id: result.campaignId,
    message_id: result.messageId,
  });
}

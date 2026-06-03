import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { syncGiftRequestConversions } from "@/lib/gift-request/conversions";

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

async function authorize(request: NextRequest) {
  const supabase = createSupabase(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", status: 401 as const };

  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId)
    return { error: "Workspace not specified", status: 400 as const };

  return { user, workspaceId };
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth)
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 500);

  const admin = createAdminClient();

  try {
    await syncGiftRequestConversions({
      admin,
      workspaceId: auth.workspaceId,
    });
  } catch (err) {
    console.error("[GiftRequest Requests] conversion sync failed:", err);
  }

  // Pega gift_requests + JOIN com wa_messages pra status real do envio
  // (status do gift_requests segue o da fila; mas se quisermos enriquecer
  // delivered_at/read_at, pegamos do wa_messages).
  let q = admin
    .from("gift_requests")
    .select(
      `
      id,
      requester_name,
      requester_phone,
      recipient_phone,
      product_id,
      product_name,
      product_url,
      product_image_url,
      product_price,
      personal_message,
      status,
      error_message,
      page_url,
      converted_order_id,
      converted_at,
      created_at,
      sent_at,
      delivered_at,
      read_at,
      wa_message_id,
      wa_messages:wa_message_id (
        status,
        sent_at,
        delivered_at,
        read_at,
        error_message,
        meta_message_id
      )
    `
    )
    .eq("workspace_id", auth.workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (data || []).map((r) => {
    const wm = Array.isArray(r.wa_messages) ? r.wa_messages[0] : r.wa_messages;
    return {
      ...r,
      // Sobrepõe timestamps com os de wa_messages quando disponíveis
      sent_at: wm?.sent_at || r.sent_at,
      delivered_at: wm?.delivered_at || r.delivered_at,
      read_at: wm?.read_at || r.read_at,
      wa_status: wm?.status || null,
      wa_error: wm?.error_message || null,
      wa_meta_message_id: wm?.meta_message_id || null,
      wa_messages: undefined,
    };
  });

  return NextResponse.json({ requests: items });
}

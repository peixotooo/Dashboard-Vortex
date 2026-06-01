import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";

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

// GET — detalhe completo de um cart + timeline dos steps.
// Retorna o cart, os steps da régua atual e as mensagens já enviadas
// (com canal, status, timestamp) pra renderizar uma timeline.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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

    const { data: cart, error: cartErr } = await admin
      .from("abandoned_carts")
      .select(
        "id, vnda_cart_token, vnda_cart_id, vnda_client_id, customer_email, customer_name, customer_phone, customer_state, customer_region, cart_total, status, abandoned_at, recovered_at, closed_at, recovery_url, items, coupon_code, recovery_coupon_expires_at, recovery_started_at, enrichment_attempted_at"
      )
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();

    if (cartErr || !cart) {
      return NextResponse.json({ error: "Cart not found" }, { status: 404 });
    }

    // Steps da régua atual.
    const { data: rule } = await admin
      .from("cart_recovery_rules")
      .select("id, expire_after_hours")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const steps: Array<{
      id: string;
      step_order: number;
      delay_minutes: number;
      whatsapp_enabled: boolean;
      email_enabled: boolean;
      coupon_pct: number;
      coupon_validity_hours: number;
    }> = [];

    if (rule) {
      const { data: stepsData } = await admin
        .from("cart_recovery_steps")
        .select(
          "id, step_order, delay_minutes, whatsapp_enabled, email_enabled, coupon_pct, coupon_validity_hours"
        )
        .eq("rule_id", rule.id)
        .order("step_order");
      steps.push(...(stepsData || []));
    }

    // Mensagens enviadas pra esse cart, com conteúdo renderizado pra
    // exibir na timeline ao clicar.
    const { data: messages } = await admin
      .from("cart_recovery_messages")
      .select(
        "step_id, channel, status, error, external_id, sent_at, rendered_payload"
      )
      .eq("cart_id", id)
      .order("sent_at");

    return NextResponse.json({
      cart,
      steps,
      messages: messages || [],
      expire_after_hours: rule?.expire_after_hours || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

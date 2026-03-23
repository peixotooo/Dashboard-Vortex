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

    const { id } = await params;
    const admin = createAdminClient();

    const { data: dispatch, error } = await admin
      .from("wapi_group_dispatches")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !dispatch)
      return NextResponse.json(
        { error: "Dispatch not found" },
        { status: 404 }
      );

    const { data: messages } = await admin
      .from("wapi_group_messages")
      .select("group_jid, group_name, status, error_message, created_at")
      .eq("dispatch_id", id)
      .order("created_at");

    return NextResponse.json({
      dispatch,
      messages: messages || [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
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

    const { id } = await params;
    const admin = createAdminClient();

    // Only cancel scheduled dispatches
    const { data: dispatch } = await admin
      .from("wapi_group_dispatches")
      .select("status")
      .eq("id", id)
      .single();

    if (!dispatch)
      return NextResponse.json(
        { error: "Dispatch not found" },
        { status: 404 }
      );

    if (dispatch.status !== "scheduled") {
      return NextResponse.json(
        { error: "Only scheduled dispatches can be cancelled" },
        { status: 400 }
      );
    }

    await admin
      .from("wapi_group_dispatches")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
      })
      .eq("id", id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

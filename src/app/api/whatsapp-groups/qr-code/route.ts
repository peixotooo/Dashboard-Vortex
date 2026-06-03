import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getWapiConfig, getQrCode, updateWapiConnected } from "@/lib/wapi-api";

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

export async function GET(request: NextRequest) {
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

    const config = await getWapiConfig(workspaceId);
    if (!config)
      return NextResponse.json(
        { error: "W-API not configured" },
        { status: 400 }
      );

    const qr = await getQrCode(config);
    if (typeof qr.connected === "boolean") {
      await updateWapiConnected(workspaceId, qr.connected);
    }

    return NextResponse.json({
      qrcode: qr.qrcode,
      connected: qr.connected ?? false,
      instanceId: qr.instanceId || config.instanceId,
      message: qr.message || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

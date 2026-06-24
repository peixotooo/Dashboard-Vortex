import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { getBioConfigByWorkspace, normalizeBioBlocks, upsertBioConfig } from "@/lib/bio/config";

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

  const admin = createAdminClient();
  const { data: membership, error } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[bio config] workspace membership check failed", error.message);
    return { error: "Failed to verify workspace access", status: 500 as const };
  }
  if (!membership) return { error: "Forbidden", status: 403 as const };

  return { user, workspaceId, role: membership.role as string };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const config = await getBioConfigByWorkspace(auth.workspaceId);
    return NextResponse.json({ config });
  } catch (error) {
    console.error("[bio config] GET failed", error);
    return NextResponse.json({ error: "Failed to load bio config" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (!["owner", "admin"].includes(auth.role)) {
      return NextResponse.json({ error: "Only admins can update bio config" }, { status: 403 });
    }

    const body = await request.json();
    const config = await upsertBioConfig(auth.workspaceId, {
      enabled: body.enabled,
      slug: body.slug,
      public_domain: body.public_domain,
      store_base_url: body.store_base_url,
      brand_name: body.brand_name,
      headline: body.headline,
      subtitle: body.subtitle,
      avatar_url: body.avatar_url || null,
      default_utm_campaign: body.default_utm_campaign,
      blocks: normalizeBioBlocks(body.blocks),
      theme: body.theme,
    });

    revalidateTag("bio-page", "max");

    return NextResponse.json({ config });
  } catch (error) {
    console.error("[bio config] PATCH failed", error);
    return NextResponse.json({ error: "Failed to save bio config" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getBioConfigByWorkspace, normalizeBioBlocks, upsertBioConfig } from "@/lib/bio/config";
import {
  getWorkspaceAdminContext,
  getWorkspaceContext,
  handleAuthError,
} from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const config = await getBioConfigByWorkspace(workspaceId);
    return NextResponse.json({ config });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse.status < 500) return authResponse;
    console.error("[bio config] GET failed", error);
    return NextResponse.json({ error: "Failed to load bio config" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceAdminContext(request);

    const body = await request.json();
    const config = await upsertBioConfig(workspaceId, {
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
    const authResponse = handleAuthError(error);
    if (authResponse.status < 500) return authResponse;
    console.error("[bio config] PATCH failed", error);
    return NextResponse.json({ error: "Failed to save bio config" }, { status: 500 });
  }
}

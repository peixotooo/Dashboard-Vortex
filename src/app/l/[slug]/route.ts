import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  if (!slug) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const admin = createAdminClient();

  const { data } = await admin
    .from("wapi_short_links")
    .select("id, final_url, click_count")
    .eq("short_code", slug)
    .single();

  if (!data?.final_url) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Increment click count (fire-and-forget, race condition acceptable)
  admin
    .from("wapi_short_links")
    .update({ click_count: (data.click_count || 0) + 1 })
    .eq("id", data.id)
    .then(() => {});

  return NextResponse.redirect(data.final_url, 302);
}

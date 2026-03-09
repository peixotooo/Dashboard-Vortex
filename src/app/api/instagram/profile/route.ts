import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getApifyConfig, scrapeInstagramProfile } from "@/lib/apify-api";

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

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// GET /api/instagram/profile?username=xxx
export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const username = request.nextUrl.searchParams.get("username") || "";
    if (!username) return NextResponse.json({ error: "username is required" }, { status: 400 });

    // Check cache
    const { data: cached } = await supabase
      .from("instagram_profiles")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("username", username)
      .single();

    if (cached?.last_scraped_at) {
      const age = Date.now() - new Date(cached.last_scraped_at).getTime();
      if (age < CACHE_TTL_MS) {
        return NextResponse.json({
          profile: {
            username: cached.username,
            fullName: cached.full_name,
            biography: cached.biography,
            followersCount: cached.followers_count,
            followingCount: cached.following_count,
            postsCount: cached.posts_count,
            profilePicUrl: cached.profile_pic_url,
            externalUrl: cached.external_url,
            businessCategory: cached.business_category,
          },
          lastScrapedAt: cached.last_scraped_at,
          fromCache: true,
        });
      }
    }

    // Scrape fresh data
    const config = await getApifyConfig(workspaceId);
    if (!config) return NextResponse.json({ error: "Apify not configured" }, { status: 400 });

    const profile = await scrapeInstagramProfile(config, username);

    // Upsert cache
    await supabase.from("instagram_profiles").upsert(
      {
        workspace_id: workspaceId,
        username: profile.username,
        full_name: profile.fullName,
        biography: profile.biography,
        followers_count: profile.followersCount,
        following_count: profile.followingCount,
        posts_count: profile.postsCount,
        profile_pic_url: profile.profilePicUrl,
        external_url: profile.externalUrl || null,
        business_category: profile.businessCategory || null,
        last_scraped_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,username" }
    );

    return NextResponse.json({
      profile,
      lastScrapedAt: new Date().toISOString(),
      fromCache: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

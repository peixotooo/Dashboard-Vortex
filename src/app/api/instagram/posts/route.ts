import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getApifyConfig, scrapeInstagramPosts } from "@/lib/apify-api";
import type { InstagramPost } from "@/lib/apify-api";

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

// GET /api/instagram/posts?username=xxx&limit=30
export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const username = request.nextUrl.searchParams.get("username") || "";
    if (!username) return NextResponse.json({ error: "username is required" }, { status: 400 });

    const limit = parseInt(request.nextUrl.searchParams.get("limit") || "30");

    // Check cache — get most recent scraped_at
    const { data: cached } = await supabase
      .from("instagram_posts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("profile_username", username)
      .order("posted_at", { ascending: false })
      .limit(limit);

    if (cached && cached.length > 0) {
      const mostRecent = cached.reduce((latest, p) =>
        new Date(p.scraped_at) > new Date(latest.scraped_at) ? p : latest
      , cached[0]);
      const age = Date.now() - new Date(mostRecent.scraped_at).getTime();

      if (age < CACHE_TTL_MS) {
        const posts: InstagramPost[] = cached.map((p) => ({
          id: p.post_id,
          shortCode: p.short_code || "",
          url: p.url || "",
          type: (p.type as "Image" | "Video" | "Sidecar") || "Image",
          timestamp: p.posted_at || p.scraped_at,
          caption: p.caption || "",
          hashtags: p.hashtags || [],
          likesCount: p.likes_count || 0,
          commentsCount: p.comments_count || 0,
          displayUrl: p.display_url || "",
          videoUrl: p.video_url || undefined,
        }));

        return NextResponse.json({
          posts,
          lastScrapedAt: mostRecent.scraped_at,
          fromCache: true,
        });
      }
    }

    // Scrape fresh data
    const config = await getApifyConfig(workspaceId);
    if (!config) return NextResponse.json({ error: "Apify not configured" }, { status: 400 });

    const posts = await scrapeInstagramPosts(config, username, limit);
    const now = new Date().toISOString();

    // Upsert cache
    if (posts.length > 0) {
      const rows = posts.map((p) => ({
        workspace_id: workspaceId,
        profile_username: username,
        post_id: p.id,
        short_code: p.shortCode,
        url: p.url,
        type: p.type,
        caption: p.caption,
        hashtags: p.hashtags,
        likes_count: p.likesCount,
        comments_count: p.commentsCount,
        display_url: p.displayUrl,
        video_url: p.videoUrl || null,
        posted_at: p.timestamp,
        scraped_at: now,
      }));

      await supabase.from("instagram_posts").upsert(rows, { onConflict: "workspace_id,post_id" });
    }

    return NextResponse.json({
      posts,
      lastScrapedAt: now,
      fromCache: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getWorkspaceContext, handleAuthError, AuthError } from "@/lib/api-auth";
import { getApifyConfig, scrapeInstagramProfile, scrapeInstagramPosts } from "@/lib/apify-api";

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

// POST /api/instagram/refresh — force fresh scrape
export const maxDuration = 120; // Apify sync calls can take up to 60s

export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const body = await request.json();
    const username = body.username;
    if (!username) return NextResponse.json({ error: "username is required" }, { status: 400 });

    const config = await getApifyConfig(workspaceId);
    if (!config) return NextResponse.json({ error: "Apify not configured" }, { status: 400 });

    // Scrape profile and posts in parallel
    const [profile, posts] = await Promise.all([
      scrapeInstagramProfile(config, username),
      scrapeInstagramPosts(config, username, 30),
    ]);

    const now = new Date().toISOString();

    // Update cache
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
        last_scraped_at: now,
      },
      { onConflict: "workspace_id,username" }
    );

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

    return NextResponse.json({ profile, posts, lastScrapedAt: now });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_ROUTES = ["/login", "/auth/callback", "/invite", "/shelves.js", "/forgot-password", "/reset-password"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  // 1. Skip middleware for API, static, and PUBLIC routes immediately for speed
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    isPublicRoute
  ) {
    return NextResponse.next();
  }

  // Skip if Supabase is not configured
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl || supabaseUrl === "your_supabase_url_here") {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Helper for timeout (used only for custom domain lookup)
  const withTimeout = async <T>(promise: Promise<T> | T, timeoutMs: number): Promise<T | null> => {
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs)
    );
    return Promise.race([promise as Promise<T>, timeoutPromise]);
  };

  // 2. Auth check via local session (reads JWT from cookie, no network call)
  let user: import("@supabase/supabase-js").User | null = null;
  try {
    const sessionResult = await withTimeout(supabase.auth.getSession(), 4000);
    user = (sessionResult as { data: { session: { user: import("@supabase/supabase-js").User } | null } })?.data?.session?.user || null;
  } catch {
    user = null;
  }

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // --- Custom domain resolution ---
  const host = request.headers.get("host") || "";
  const isDefaultHost =
    host.includes("vercel.app") ||
    host.includes("localhost") ||
    host.includes("127.0.0.1");

  if (!isDefaultHost && host) {
    // Check if we already resolved this domain recently (cookie cache)
    const cached = request.cookies.get("vortex_domain_workspace")?.value;

    if (!cached) {
      // Lookup workspace by custom_domain with timeout
      const workspaceQuery = supabase
        .from("workspaces")
        .select("id")
        .eq("custom_domain", host)
        .limit(1)
        .single();
        
      const workspaceResponse = await withTimeout(workspaceQuery, 600);

      const ws = (workspaceResponse as any)?.data;

      if (ws?.id) {
        supabaseResponse.cookies.set("vortex_domain_workspace", ws.id, {
          path: "/",
          maxAge: 300, // 5 minutes cache
          httpOnly: false, // client needs to read it
          sameSite: "lax",
        });
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|shelves\\.js|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

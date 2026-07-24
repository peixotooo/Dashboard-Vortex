import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// "/design" = style guide estático do design system (nenhum dado de workspace).
const PUBLIC_ROUTES = ["/login", "/auth/callback", "/invite", "/g", "/shelves.js", "/assistant.js", "/forgot-password", "/reset-password", "/avaliar", "/bio", "/chat", "/design"];
const GROUPS_PUBLIC_HOSTS = (
  process.env.WHATSAPP_GROUPS_PUBLIC_HOSTS || "grupos.bulking.com.br"
)
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
const BIO_PUBLIC_HOSTS = (
  process.env.BIO_PUBLIC_HOSTS || "bio.bulking.com.br"
)
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
// Subdomínio dedicado do Chat Commerce (/chat) — URL limpa pra bio/divulgação.
const CHAT_PUBLIC_HOSTS = (
  process.env.CHAT_PUBLIC_HOSTS || "chat.bulking.com.br"
)
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
const GROUPS_DEFAULT_SLUG = process.env.WHATSAPP_GROUPS_DEFAULT_SLUG || "vip";

function isGroupsPublicHost(host: string): boolean {
  const normalized = host.split(":")[0].toLowerCase();
  return GROUPS_PUBLIC_HOSTS.includes(normalized);
}

function isBioPublicHost(host: string): boolean {
  const normalized = host.split(":")[0].toLowerCase();
  return BIO_PUBLIC_HOSTS.includes(normalized);
}

function isChatPublicHost(host: string): boolean {
  const normalized = host.split(":")[0].toLowerCase();
  return CHAT_PUBLIC_HOSTS.includes(normalized);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host") || "";

  if (isGroupsPublicHost(host)) {
    const url = request.nextUrl.clone();
    const slug = pathname === "/" ? GROUPS_DEFAULT_SLUG : pathname.split("/").filter(Boolean)[0];
    if (!slug) {
      url.pathname = `/g/${GROUPS_DEFAULT_SLUG}`;
    } else if (!pathname.startsWith("/g/")) {
      url.pathname = `/g/${slug}`;
    }
    return NextResponse.rewrite(url);
  }

  if (isBioPublicHost(host) && pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/bio";
    return NextResponse.rewrite(url);
  }

  // chat.bulking.com.br → serve o Chat Commerce (/chat). Qualquer path do
  // subdomínio que não seja o próprio /chat cai na raiz do chat.
  if (isChatPublicHost(host) && !pathname.startsWith("/chat")) {
    const url = request.nextUrl.clone();
    url.pathname = "/chat";
    return NextResponse.rewrite(url);
  }

  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

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

  // 2. Auth check verified by Supabase (never trust the cookie payload alone).
  let user: import("@supabase/supabase-js").User | null = null;
  try {
    const userResult = await withTimeout(supabase.auth.getUser(), 4000);
    user = userResult?.data.user ?? null;
  } catch {
    user = null;
  }

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // --- Custom domain resolution ---
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
        
      const workspaceResponse = await withTimeout(workspaceQuery, 2000);

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
    "/((?!_next/static|_next/image|favicon\\.ico|shelves\\.js|assistant\\.js|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

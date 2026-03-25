import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { eccosys } from "@/lib/eccosys/client";

/**
 * GET /api/eccosys/connections
 * Returns connection status based on env vars (read-only).
 * Token is configured directly in Vercel — never stored in the database.
 */
export async function GET(req: NextRequest) {
  // Authenticate user
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = eccosys.getConfig();

  return NextResponse.json({
    configured: !!config,
    ambiente: config?.ambiente ?? null,
    // Never expose the token — only confirm it exists
    tokenSet: !!process.env.ECCOSYS_API_TOKEN,
  });
}

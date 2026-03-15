import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { filterContacts } from "@/lib/wa-compliance";

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll() {},
      },
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const { phones, cooldownDays = 7 } = await request.json();
    if (!Array.isArray(phones)) {
      return NextResponse.json({ error: "Missing phones array" }, { status: 400 });
    }

    const contacts = phones.map((p: string) => ({ phone: p }));
    const result = await filterContacts(workspaceId, contacts, cooldownDays);

    return NextResponse.json({
      allowedCount: result.allowed.length,
      cooldownCount: result.cooldownCount,
      blockedCount: result.blockedCount,
      excludedCount: result.excludedCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

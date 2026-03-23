import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getWapiConfig, listGroups } from "@/lib/wapi-api";

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

export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId)
      return NextResponse.json(
        { error: "Workspace not specified" },
        { status: 400 }
      );

    const config = await getWapiConfig(workspaceId);
    if (!config)
      return NextResponse.json(
        { error: "W-API not configured" },
        { status: 400 }
      );

    const raw = await listGroups(config);

    // W-API pode retornar array direto, ou objeto wrapper
    // Normalizar para array de { id, name }
    let groupList: Array<{ id: string; name: string }> = [];

    if (Array.isArray(raw)) {
      groupList = raw.map((g: Record<string, unknown>) => ({
        id: (g.id || g.jid || g.groupId || "") as string,
        name: (g.name || g.subject || g.groupName || "Sem nome") as string,
      }));
    } else if (raw && typeof raw === "object") {
      // Pode vir como { groups: [...] } ou { data: [...] } etc
      const obj = raw as Record<string, unknown>;
      const arr = (obj.groups || obj.data || obj.result || []) as Array<Record<string, unknown>>;
      if (Array.isArray(arr)) {
        groupList = arr.map((g) => ({
          id: (g.id || g.jid || g.groupId || "") as string,
          name: (g.name || g.subject || g.groupName || "Sem nome") as string,
        }));
      }
    }

    // Filtrar apenas grupos validos (com @g.us no id)
    groupList = groupList.filter((g) => g.id && g.id.includes("@g.us"));

    console.log(`[W-API Groups] Raw keys: ${typeof raw === "object" && raw ? Object.keys(raw as object).join(",") : typeof raw}, normalized: ${groupList.length} groups`);

    return NextResponse.json({ groups: groupList });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

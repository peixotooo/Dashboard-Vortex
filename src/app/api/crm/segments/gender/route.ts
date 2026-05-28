import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";

// Segmentação por gênero inferido.
//
// GET /api/crm/segments/gender?gender=female&min_confidence=medium
//
// Query params:
//   gender          : 'female' | 'male' | 'unknown'           (default: female)
//   min_confidence  : 'high' | 'medium' | 'low'               (default: medium)
//   format          : 'summary' | 'list'                      (default: summary)
//   limit, offset   : paginação no formato 'list'             (default: 1000/0)
//
// summary devolve só os contadores por tier — barato, ótimo pro painel.
// list devolve os emails — usado quando a campanha vai ser disparada.

export const maxDuration = 15;

const CONFIDENCE_ORDER = ["low", "medium", "high"] as const;
type Confidence = (typeof CONFIDENCE_ORDER)[number];

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

function allowedConfidences(min: Confidence): Confidence[] {
  const idx = CONFIDENCE_ORDER.indexOf(min);
  return CONFIDENCE_ORDER.slice(idx);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const sp = request.nextUrl.searchParams;
    const gender = (sp.get("gender") || "female") as "female" | "male" | "unknown";
    const minConfidence = (sp.get("min_confidence") || "medium") as Confidence;
    const format = (sp.get("format") || "summary") as "summary" | "list";
    const limit = Math.min(parseInt(sp.get("limit") || "1000", 10) || 1000, 5000);
    const offset = parseInt(sp.get("offset") || "0", 10) || 0;

    if (!CONFIDENCE_ORDER.includes(minConfidence)) {
      return NextResponse.json({ error: "Invalid min_confidence" }, { status: 400 });
    }
    if (!["female", "male", "unknown"].includes(gender)) {
      return NextResponse.json({ error: "Invalid gender" }, { status: 400 });
    }

    const admin = createAdminClient();
    const confidences = allowedConfidences(minConfidence);

    // Resumo: contadores por tier — uma query agregada via PostgREST
    // não é tão direta, então fazemos counts por tier individualmente.
    // São 3 queries leves (high/medium/low) — barato dado o índice
    // (workspace_id, inferred_gender, confidence).
    const counts: Record<Confidence, number> = { high: 0, medium: 0, low: 0 };
    for (const c of CONFIDENCE_ORDER) {
      const { count } = await admin
        .from("customer_gender_inference")
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("inferred_gender", gender)
        .eq("confidence", c);
      counts[c] = count ?? 0;
    }

    const selectedTotal = confidences.reduce((s, c) => s + counts[c], 0);

    if (format === "summary") {
      return NextResponse.json({
        gender,
        min_confidence: minConfidence,
        counts,
        selected_total: selectedTotal,
      }, { headers: { "Cache-Control": "private, max-age=120" } });
    }

    // format=list — paginado
    const { data, error } = await admin
      .from("customer_gender_inference")
      .select("email, confidence, source, matched_name, female_ratio")
      .eq("workspace_id", workspaceId)
      .eq("inferred_gender", gender)
      .in("confidence", confidences)
      .order("confidence", { ascending: false })  // high → medium → low
      .order("email", { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      gender,
      min_confidence: minConfidence,
      counts,
      selected_total: selectedTotal,
      limit,
      offset,
      rows: data ?? [],
    }, { headers: { "Cache-Control": "private, max-age=120" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[CRM segments/gender] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

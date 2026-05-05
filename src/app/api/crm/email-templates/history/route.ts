// src/app/api/crm/email-templates/history/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { applyUtmTracking, buildCampaignSlug, sanitizeEmailHtml } from "@/lib/email-templates/tracking";

interface SuggestionRow {
  id: string;
  slot: number;
  generated_for_date: string;
  rendered_html?: string;
  [k: string]: unknown;
}

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);

    const { searchParams } = new URL(req.url);
    const days = Math.min(
      Math.max(parseInt(searchParams.get("days") ?? "30", 10) || 30, 1),
      90
    );
    const status = searchParams.get("status");
    const slotParam = searchParams.get("slot");
    const slot = slotParam ? parseInt(slotParam, 10) : null;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const todayBrt = new Date(Date.now() - 3 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const supabase = createAdminClient();
    let q = supabase
      .from("email_template_suggestions")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .gte("generated_for_date", since)
      .lt("generated_for_date", todayBrt) // history excludes today
      .order("generated_for_date", { ascending: false })
      .order("slot", { ascending: true });

    if (status === "pending" || status === "selected" || status === "sent") {
      q = q.eq("status", status);
    }
    if (slot === 1 || slot === 2 || slot === 3) {
      q = q.eq("slot", slot);
    }

    const { data, count, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Stamp UTMs on the rendered_html as we serve it (see /active for the
    // rationale — keeps stored HTML canonical so tracking rules can change
    // without rewriting rows).
    const suggestions = ((data ?? []) as SuggestionRow[]).map((s) => {
      if (typeof s.rendered_html !== "string") return s;
      return {
        ...s,
        rendered_html: sanitizeEmailHtml(
          applyUtmTracking(s.rendered_html, {
            campaign: buildCampaignSlug({
              kind: "suggestion",
              date: s.generated_for_date,
              slot: s.slot,
              source_id: s.id,
            }),
            id: s.id,
          })
        ),
      };
    });

    return NextResponse.json({ suggestions, total: count ?? 0 });
  } catch (err) {
    return handleAuthError(err);
  }
}

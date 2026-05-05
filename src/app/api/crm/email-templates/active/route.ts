// src/app/api/crm/email-templates/active/route.ts
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

    // BRT date (UTC-3)
    const brt = new Date(Date.now() - 3 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("email_template_suggestions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("generated_for_date", brt)
      .order("slot", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Stamp UTMs on the rendered_html as we serve it. Stored HTML stays
    // canonical; tracking rules can change without rewriting rows.
    const suggestions = ((data ?? []) as SuggestionRow[]).map((s) => {
      if (typeof s.rendered_html !== "string") return s;
      const campaign = buildCampaignSlug({
        kind: "suggestion",
        date: s.generated_for_date,
        slot: s.slot,
        source_id: s.id,
      });
      return {
        ...s,
        rendered_html: sanitizeEmailHtml(
          applyUtmTracking(s.rendered_html, {
            campaign,
            id: s.id,
          })
        ),
      };
    });

    return NextResponse.json({ date: brt, suggestions });
  } catch (err) {
    return handleAuthError(err);
  }
}

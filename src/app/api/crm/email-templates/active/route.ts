// src/app/api/crm/email-templates/active/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getAuthenticatedContext(req);

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
    return NextResponse.json({ date: brt, suggestions: data ?? [] });
  } catch (err) {
    return handleAuthError(err);
  }
}

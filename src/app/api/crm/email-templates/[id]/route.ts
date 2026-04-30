// src/app/api/crm/email-templates/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getAuthenticatedContext(req);
    const { id } = await params;

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("email_template_suggestions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    return handleAuthError(err);
  }
}

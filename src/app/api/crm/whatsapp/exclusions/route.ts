import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

// GET: List all exclusions
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("wa_exclusions")
      .select("id, phone, contact_name, reason, notes, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ exclusions: data || [] });
  } catch (error) {
    return handleAuthError(error);
  }
}

// POST: Add phone(s) to exclusion list
export async function POST(request: NextRequest) {
  try {
    const { userId, workspaceId } = await getWorkspaceContext(request);

    const body = await request.json();
    const entries: Array<{ phone: string; contact_name?: string; reason?: string; notes?: string }> =
      body.entries || [body];

    if (!entries.length || !entries[0].phone) {
      return NextResponse.json({ error: "Missing phone" }, { status: 400 });
    }

    const admin = createAdminClient();
    const rows = entries.map((e) => ({
      workspace_id: workspaceId,
      phone: e.phone.replace(/\D/g, ""),
      contact_name: e.contact_name || null,
      reason: e.reason || "manual",
      notes: e.notes || null,
      created_by: userId,
    }));

    const { data, error } = await admin
      .from("wa_exclusions")
      .upsert(rows, { onConflict: "workspace_id,phone", ignoreDuplicates: true })
      .select();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ added: data?.length || 0 });
  } catch (error) {
    return handleAuthError(error);
  }
}

// DELETE: Remove from exclusion list
export async function DELETE(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const admin = createAdminClient();
    const { error } = await admin
      .from("wa_exclusions")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleAuthError(error);
  }
}

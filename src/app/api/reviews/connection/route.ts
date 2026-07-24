import { NextRequest, NextResponse } from "next/server";
import {
  getWorkspaceAdminContext,
  getWorkspaceContext,
  handleAuthError,
} from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { encrypt } from "@/lib/encryption";
import { readLimitedJson } from "@/lib/security/webhook-request";

// Status da conexão Yourviews (sem nunca devolver segredos pro browser).
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const admin = createAdminClient();
    const { data } = await admin
      .from("yourviews_connections")
      .select("store_key, last_synced_at, last_sync_status, last_sync_message, total_imported, updated_at")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!data) return NextResponse.json({ connection: null });

    // Devolve só um preview mascarado do store_key (descriptografar e mascarar).
    return NextResponse.json({
      connection: {
        configured: true,
        last_synced_at: data.last_synced_at,
        last_sync_status: data.last_sync_status,
        last_sync_message: data.last_sync_message,
        total_imported: data.total_imported,
        updated_at: data.updated_at,
      },
    });
  } catch (e) {
    return handleAuthError(e);
  }
}

// Salva/atualiza as credenciais da Yourviews (criptografadas).
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceAdminContext(request);
    const parsed = await readLimitedJson(request, 32 * 1024);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }
    const body = parsed.value as Record<string, unknown>;
    const { store_key, api_username, api_password } = body;

    if (
      typeof store_key !== "string" ||
      !store_key.trim() ||
      store_key.length > 512 ||
      typeof api_username !== "string" ||
      !api_username.trim() ||
      api_username.length > 512 ||
      typeof api_password !== "string" ||
      !api_password.trim() ||
      api_password.length > 4096
    ) {
      return NextResponse.json(
        { error: "store_key, api_username e api_password são obrigatórios" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { error } = await admin.from("yourviews_connections").upsert(
      {
        workspace_id: workspaceId,
        store_key: encrypt(String(store_key).trim()),
        api_username: encrypt(String(api_username).trim()),
        api_password: encrypt(String(api_password).trim()),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleAuthError(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceAdminContext(request);
    const admin = createAdminClient();
    const { error } = await admin
      .from("yourviews_connections")
      .delete()
      .eq("workspace_id", workspaceId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleAuthError(e);
  }
}

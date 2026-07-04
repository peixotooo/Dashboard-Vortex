import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { upsertGiftRequestLead } from "@/lib/gift-request/crm-lead";

// POST /api/gift-request/sync-leads
// Backfill: pega todos os gift_requests do workspace e popula a lista
// CRM "Pedidos de presente" (dedup por phone). Útil pra capturar
// retroativamente os leads que entraram antes desse fluxo existir.
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();

    const { data: requests } = await admin
      .from("gift_requests")
      .select("requester_name, requester_phone, created_at")
      .eq("workspace_id", workspaceId)
      .not("requester_phone", "is", null)
      .order("created_at", { ascending: true });

    let added = 0;
    let skipped = 0;
    let errors = 0;

    for (const r of requests || []) {
      if (!r.requester_phone) {
        skipped++;
        continue;
      }
      const result = await upsertGiftRequestLead({
        admin,
        workspaceId,
        name: r.requester_name,
        phone: r.requester_phone,
      });
      if (result.ok) added++;
      else errors++;
    }

    // Retorna o estado final da lista
    const { data: list } = await admin
      .from("crm_contact_lists")
      .select("id, name, total_count")
      .eq("workspace_id", workspaceId)
      .eq("name", "Pedidos de presente")
      .maybeSingle();

    return NextResponse.json({
      processed: requests?.length || 0,
      added,
      skipped,
      errors,
      list: list || null,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

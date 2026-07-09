import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { invalidateEngineCache } from "@/lib/controladoria/engine";

const SELECT =
  "id, doc_number, description, observation, competence_date, due_date, paid_at, amount, flow, kind, needs_review, source, created_at, " +
  "partner:fin_partners(id, name), classification:fin_classifications(id, path, name, category), account:fin_bank_accounts(id, code)";

// PATCH — edição parcial (toggle pago, revisão, valores, datas, classificação…)
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const { id } = await ctx.params;
    const body = await request.json();
    const supabase = createAdminClient();

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of ["doc_number", "description", "observation", "competence_date", "due_date", "paid_at", "bank_account_id", "needs_review"]) {
      if (k in body) patch[k] = body[k];
    }
    if ("amount" in body) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: "amount inválido" }, { status: 400 });
      }
      patch.amount = amount;
    }
    if (body.classification_id) {
      const { data: cls } = await supabase
        .from("fin_classifications")
        .select("id, flow, is_transfer, is_depreciation")
        .eq("workspace_id", workspaceId)
        .eq("id", body.classification_id)
        .single();
      if (!cls) return NextResponse.json({ error: "classificação não encontrada" }, { status: 400 });
      patch.classification_id = cls.id;
      patch.flow = cls.flow;
      patch.kind = cls.is_transfer ? "transfer" : cls.is_depreciation ? "depreciation" : "normal";
    }
    if (body.partner_name !== undefined) {
      if (body.partner_name) {
        const { data: partner, error: pErr } = await supabase
          .from("fin_partners")
          .upsert({ workspace_id: workspaceId, name: String(body.partner_name).trim() }, { onConflict: "workspace_id,name" })
          .select("id")
          .single();
        if (pErr) throw pErr;
        patch.partner_id = partner.id;
      } else {
        patch.partner_id = null;
      }
    }

    const { data, error } = await supabase
      .from("fin_entries")
      .update(patch)
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .select(SELECT)
      .single();
    if (error) throw error;
    invalidateEngineCache(workspaceId);
    return NextResponse.json({ row: data });
  } catch (err) {
    return handleAuthError(err);
  }
}

// DELETE — lixeira (soft delete; ?hard=1 não é suportado de propósito)
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const { id } = await ctx.params;
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("fin_entries")
      .update({ deleted_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("id", id);
    if (error) throw error;
    invalidateEngineCache(workspaceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAuthError(err);
  }
}

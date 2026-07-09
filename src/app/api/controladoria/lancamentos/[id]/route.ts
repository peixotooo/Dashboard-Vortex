import { NextRequest, NextResponse } from "next/server";
import { getControladoriaContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { invalidateEngineCache } from "@/lib/controladoria/engine";

const SELECT =
  "id, doc_number, description, observation, competence_date, due_date, paid_at, amount, flow, kind, needs_review, source, created_at, " +
  "partner:fin_partners(id, name), classification:fin_classifications(id, path, name, category), account:fin_bank_accounts(id, code)";

// PATCH — edição parcial (toggle pago, revisão, valores, datas, classificação…)
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspaceId } = await getControladoriaContext(request);
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

// DELETE — lixeira (soft delete). ?series=1 exclui a série de parcelas inteira
// (mesmo recurrence_group), quando a coluna existir.
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspaceId } = await getControladoriaContext(request);
    const { id } = await ctx.params;
    const series = request.nextUrl.searchParams.get("series") === "1";
    const supabase = createAdminClient();
    const now = new Date().toISOString();

    let affected = 1;
    if (series) {
      const { data: row } = await supabase
        .from("fin_entries")
        .select("recurrence_group")
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .maybeSingle();
      const group = (row as { recurrence_group?: string } | null)?.recurrence_group;
      if (group) {
        const { data, error } = await supabase
          .from("fin_entries")
          .update({ deleted_at: now })
          .eq("workspace_id", workspaceId)
          .eq("recurrence_group", group)
          .is("deleted_at", null)
          .select("id");
        if (error) throw error;
        affected = data?.length ?? 0;
        invalidateEngineCache(workspaceId);
        return NextResponse.json({ ok: true, affected });
      }
    }
    const { error } = await supabase
      .from("fin_entries")
      .update({ deleted_at: now })
      .eq("workspace_id", workspaceId)
      .eq("id", id);
    if (error) throw error;
    invalidateEngineCache(workspaceId);
    return NextResponse.json({ ok: true, affected });
  } catch (err) {
    return handleAuthError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const maxDuration = 60;

const SELECT =
  "id, doc_number, description, observation, competence_date, due_date, paid_at, amount, flow, kind, needs_review, source, created_at, " +
  "partner:fin_partners(id, name), classification:fin_classifications(id, path, name, category), account:fin_bank_accounts(id, code)";

// GET /api/controladoria/lancamentos?page=1&q=&classification_id=&account_id=&status=&due_from=&due_to=
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const p = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(p.get("page") ?? "1", 10));
    const pageSize = Math.min(100, parseInt(p.get("pageSize") ?? "50", 10));
    const supabase = createAdminClient();

    let q = supabase
      .from("fin_entries")
      .select(SELECT, { count: "exact" })
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null);

    const text = p.get("q");
    if (text) q = q.or(`description.ilike.%${text}%,doc_number.ilike.%${text}%`);
    if (p.get("classification_id")) q = q.eq("classification_id", p.get("classification_id")!);
    if (p.get("account_id")) q = q.eq("bank_account_id", p.get("account_id")!);
    if (p.get("partner_id")) q = q.eq("partner_id", p.get("partner_id")!);
    const status = p.get("status");
    if (status === "pagos") q = q.not("paid_at", "is", null);
    if (status === "pendentes") q = q.is("paid_at", null);
    if (status === "revisao") q = q.eq("needs_review", true);
    if (p.get("due_from")) q = q.gte("due_date", p.get("due_from")!);
    if (p.get("due_to")) q = q.lte("due_date", p.get("due_to")!);

    const { data, count, error } = await q
      .order("due_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw error;
    return NextResponse.json({ rows: data ?? [], total: count ?? 0, page, pageSize });
  } catch (err) {
    return handleAuthError(err);
  }
}

// POST /api/controladoria/lancamentos — cria lançamento manual
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const body = await request.json();
    const supabase = createAdminClient();

    const amount = Number(body.amount);
    if (!body.classification_id || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "classification_id e amount (>0) são obrigatórios" }, { status: 400 });
    }
    const { data: cls } = await supabase
      .from("fin_classifications")
      .select("id, flow, is_transfer, is_depreciation")
      .eq("workspace_id", workspaceId)
      .eq("id", body.classification_id)
      .single();
    if (!cls) return NextResponse.json({ error: "classificação não encontrada" }, { status: 400 });

    let partnerId: string | null = null;
    if (body.partner_name) {
      const { data: partner, error: pErr } = await supabase
        .from("fin_partners")
        .upsert({ workspace_id: workspaceId, name: String(body.partner_name).trim() }, { onConflict: "workspace_id,name" })
        .select("id")
        .single();
      if (pErr) throw pErr;
      partnerId = partner.id;
    }

    const { data, error } = await supabase
      .from("fin_entries")
      .insert({
        workspace_id: workspaceId,
        doc_number: body.doc_number || null,
        description: body.description || null,
        observation: body.observation || null,
        partner_id: partnerId,
        classification_id: cls.id,
        bank_account_id: body.bank_account_id || null,
        competence_date: body.competence_date || null,
        due_date: body.due_date || null,
        paid_at: body.paid_at || null,
        amount,
        flow: cls.flow,
        kind: cls.is_transfer ? "transfer" : cls.is_depreciation ? "depreciation" : "normal",
        source: "manual",
      })
      .select(SELECT)
      .single();
    if (error) throw error;
    return NextResponse.json({ row: data });
  } catch (err) {
    return handleAuthError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getControladoriaContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { invalidateEngineCache } from "@/lib/controladoria/engine";

export const maxDuration = 60;

const SELECT =
  "id, doc_number, description, observation, competence_date, due_date, paid_at, amount, flow, kind, needs_review, source, created_at, " +
  "partner:fin_partners(id, name), classification:fin_classifications(id, path, name, category), account:fin_bank_accounts(id, code)";

// GET /api/controladoria/lancamentos?page=1&q=&classification_id=&account_id=
//   &status=&due_from=&due_to=&paid_from=&paid_to=&quick=
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getControladoriaContext(request);
    const p = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(p.get("page") ?? "1", 10));
    const pageSize = Math.min(100, parseInt(p.get("pageSize") ?? "50", 10));
    const supabase = createAdminClient();

    // Mesmos filtros para a query de dados e a de totais.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyFilters = <T extends { [k: string]: (...a: any[]) => T }>(query: T): T => {
      let q = query;
      q = (q as any).eq("workspace_id", workspaceId).is("deleted_at", null);
      const text = p.get("q");
      if (text) q = (q as any).or(`description.ilike.%${text}%,doc_number.ilike.%${text}%`);
      if (p.get("classification_id")) q = (q as any).eq("classification_id", p.get("classification_id")!);
      if (p.get("account_id")) q = (q as any).eq("bank_account_id", p.get("account_id")!);
      if (p.get("partner_id")) q = (q as any).eq("partner_id", p.get("partner_id")!);
      const status = p.get("status");
      if (status === "pagos") q = (q as any).not("paid_at", "is", null);
      if (status === "pendentes") q = (q as any).is("paid_at", null);
      if (status === "revisao") q = (q as any).eq("needs_review", true);
      if (p.get("due_from")) q = (q as any).gte("due_date", p.get("due_from")!);
      if (p.get("due_to")) q = (q as any).lte("due_date", p.get("due_to")!);
      if (p.get("paid_from")) q = (q as any).gte("paid_at", p.get("paid_from")!);
      if (p.get("paid_to")) q = (q as any).lte("paid_at", p.get("paid_to")!);
      const quick = p.get("quick");
      if (quick) {
        const today = new Date().toISOString().slice(0, 10);
        const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
        if (quick === "atraso") q = (q as any).is("paid_at", null).lt("due_date", today);
        if (quick === "hoje") q = (q as any).is("paid_at", null).eq("due_date", today);
        if (quick === "semana") q = (q as any).is("paid_at", null).gte("due_date", today).lte("due_date", in7);
        if (quick === "receber") q = (q as any).is("paid_at", null).eq("flow", 1);
        if (quick === "pagar") q = (q as any).is("paid_at", null).eq("flow", -1);
      }
      return q;
    };

    // Ordenação do SenseBoard: mais recém-CADASTRADOS primeiro (não vencimento —
    // recorrências/depreciações futuras iriam pro topo).
    const { data, count, error } = await applyFilters(
      supabase.from("fin_entries").select(SELECT, { count: "exact" }) as any
    )
      .order("source_created_at", { ascending: false, nullsFirst: true })
      .order("created_at", { ascending: false })
      .order("due_date", { ascending: false, nullsFirst: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw error;

    // Totais (entradas/saídas/saldo) sobre TODO o conjunto filtrado, não só a
    // página. Teto de segurança para o caso "sem filtro" (72k lançamentos).
    let totals: { entradas: number; saidas: number; saldo: number } | null = null;
    const CAP = 60000;
    if ((count ?? 0) <= CAP) {
      let entradas = 0, saidas = 0;
      for (let from = 0; ; from += 1000) {
        const { data: chunk, error: e2 } = await applyFilters(
          supabase.from("fin_entries").select("amount, flow") as any
        ).range(from, from + 999);
        if (e2) throw e2;
        for (const r of (chunk ?? []) as { amount: number; flow: number }[]) {
          if (r.flow === 1) entradas += Number(r.amount);
          else saidas += Number(r.amount);
        }
        if (!chunk || chunk.length < 1000) break;
      }
      totals = { entradas, saidas, saldo: entradas - saidas };
    }

    return NextResponse.json({ rows: data ?? [], total: count ?? 0, page, pageSize, totals });
  } catch (err) {
    return handleAuthError(err);
  }
}

// POST /api/controladoria/lancamentos — cria lançamento manual
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getControladoriaContext(request);
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

    // Repetições (parcelas/recorrência): N lançamentos mensais compartilhando
    // recurrence_group. "manter competência" fixa a competência do 1º em todas
    // as parcelas (ex.: provisão) — como no SenseBoard.
    const reps = Math.max(1, Math.min(120, parseInt(String(body.repeat_count ?? 1), 10) || 1));
    const keepCompetence = !!body.repeat_keep_competence;
    const kind = cls.is_transfer ? "transfer" : cls.is_depreciation ? "depreciation" : "normal";
    const nowIso = new Date().toISOString();
    // recurrence_group agrupa as parcelas p/ editar/excluir em bloco (migration-136).
    // Enquanto essa coluna não existir no banco, degradamos: as parcelas ainda são
    // criadas e ficam agrupadas pela descrição "(i/N)", como no SenseBoard.
    const groupId = reps > 1 ? crypto.randomUUID() : null;
    const hasGroupCol = await supabase
      .from("fin_entries")
      .select("recurrence_group")
      .limit(1)
      .then(({ error }) => !error);

    const addMonths = (iso: string | null, n: number): string | null => {
      if (!iso) return null;
      const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1 + n, d));
      // se o dia estourou o mês (ex.: 31 → mês curto), volta pro último dia
      if (dt.getUTCMonth() !== (m - 1 + n) % 12) dt.setUTCDate(0);
      return dt.toISOString().slice(0, 10);
    };

    const rows = Array.from({ length: reps }, (_, i) => ({
      workspace_id: workspaceId,
      doc_number: body.doc_number || null,
      description: reps > 1 && body.description ? `(${i + 1}/${reps}) ${body.description}` : body.description || null,
      observation: body.observation || null,
      partner_id: partnerId,
      classification_id: cls.id,
      bank_account_id: body.bank_account_id || null,
      competence_date: keepCompetence ? body.competence_date || null : addMonths(body.competence_date || null, i),
      due_date: addMonths(body.due_date || null, i),
      paid_at: i === 0 ? body.paid_at || null : null, // só a 1ª pode nascer paga
      amount,
      flow: cls.flow,
      kind,
      ...(hasGroupCol ? { recurrence_group: groupId } : {}),
      source: "manual",
      source_created_at: nowIso,
    }));

    const { data, error } = await supabase.from("fin_entries").insert(rows).select(SELECT);
    if (error) throw error;
    invalidateEngineCache(workspaceId);
    return NextResponse.json({ row: data?.[0], count: data?.length ?? 0 });
  } catch (err) {
    return handleAuthError(err);
  }
}

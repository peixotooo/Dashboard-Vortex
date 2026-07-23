import { NextRequest, NextResponse } from "next/server";
import { getControladoriaContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { invalidateEngineCache } from "@/lib/controladoria/engine";
import {
  parseNfe, descricaoNf, observacaoNf, normalizaNome, onlyDigits,
  type NfeParsed, type NfeParcela,
} from "@/lib/controladoria/nfe-xml";

export const maxDuration = 60;

// CNPJs da empresa (matriz + filiais). Só notas com dest = um destes viram
// conta a pagar. Configurável em fin_settings.cash_planning.nfe_cnpjs.
const CNPJS_PADRAO = ["17788352000156"]; // Bulking Indústria e Comércio de Roupas

// Classificações que poluem a sugestão por fornecedor: juros de atraso são
// lançados à parte, nunca vêm da NF.
const EXCLUI_DA_SUGESTAO = /Juros e multas/i;

type PreviewParcela = NfeParcela & { parcela: string };

interface Preview {
  arquivo: string;
  ok: boolean;
  erro?: string;
  chave?: string;
  numero?: string;
  serie?: string;
  emitNome?: string;
  emitFantasia?: string;
  emitCnpj?: string;
  emissao?: string;
  natOp?: string;
  itens?: string;
  valor?: number;
  cfops?: string[];
  avisos?: string[];
  parcelas?: PreviewParcela[];
  partner?: { id: string | null; name: string; novo: boolean };
  classification?: { id: string | null; path: string | null; dominancia: number | null };
  duplicada?: { parcelas: number; descricao: string | null };
}

async function cnpjsDaEmpresa(supabase: ReturnType<typeof createAdminClient>, workspaceId: string) {
  const { data } = await supabase.from("fin_settings").select("cash_planning").eq("workspace_id", workspaceId).maybeSingle();
  const cfg = (data?.cash_planning ?? {}) as { nfe_cnpjs?: string[] };
  const lista = Array.isArray(cfg.nfe_cnpjs) && cfg.nfe_cnpjs.length ? cfg.nfe_cnpjs : CNPJS_PADRAO;
  return lista.map(onlyDigits).filter(Boolean);
}

// POST — lê os XMLs e devolve a PRÉVIA (não grava nada)
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getControladoriaContext(request);
    const body = await request.json();
    const arquivos: { nome: string; xml: string }[] = Array.isArray(body.arquivos) ? body.arquivos.slice(0, 40) : [];
    if (!arquivos.length) return NextResponse.json({ error: "nenhum arquivo enviado" }, { status: 400 });

    const supabase = createAdminClient();
    const nossosCnpjs = await cnpjsDaEmpresa(supabase, workspaceId);

    // cadastro para casar fornecedor por nome normalizado / CNPJ
    const { data: partners } = await supabase
      .from("fin_partners").select("id, name, cpf_cnpj").eq("workspace_id", workspaceId);
    const porNome = new Map<string, { id: string; name: string }>();
    const porCnpj = new Map<string, { id: string; name: string }>();
    for (const p of partners ?? []) {
      porNome.set(normalizaNome(p.name), { id: p.id, name: p.name });
      const doc = onlyDigits(p.cpf_cnpj ?? "");
      if (doc) porCnpj.set(doc, { id: p.id, name: p.name });
    }

    const { data: clsRows } = await supabase
      .from("fin_classifications").select("id, path, is_active").eq("workspace_id", workspaceId);
    const clsById = new Map((clsRows ?? []).map((c) => [c.id, c]));

    const previews: Preview[] = [];
    for (const arq of arquivos) {
      const r = parseNfe(String(arq.xml ?? ""), nossosCnpjs);
      if (!r.ok) { previews.push({ arquivo: arq.nome, ok: false, erro: r.erro }); continue; }
      const nfe: NfeParsed = r.nfe;

      // já importada? (a chave vive na observação, convenção do financeiro)
      const { data: dup } = await supabase
        .from("fin_entries").select("id, description").eq("workspace_id", workspaceId)
        .is("deleted_at", null).ilike("observation", `%${nfe.chave}%`);

      // fornecedor: CNPJ primeiro, depois nome normalizado
      const achado = porCnpj.get(nfe.emitCnpj) ?? porNome.get(normalizaNome(nfe.emitNome)) ?? null;

      // classificação sugerida = dominante histórica do fornecedor (ativa,
      // ignorando juros de atraso)
      let sugestao: Preview["classification"] = { id: null, path: null, dominancia: null };
      if (achado) {
        const { data: hist } = await supabase
          .from("fin_entries").select("classification_id").eq("workspace_id", workspaceId)
          .eq("partner_id", achado.id).eq("flow", -1).is("deleted_at", null)
          .order("competence_date", { ascending: false }).limit(400);
        const contagem = new Map<string, number>();
        for (const h of hist ?? []) {
          const c = clsById.get(h.classification_id);
          if (!c || EXCLUI_DA_SUGESTAO.test(c.path)) continue;
          contagem.set(h.classification_id, (contagem.get(h.classification_id) ?? 0) + 1);
        }
        const total = [...contagem.values()].reduce((a, b) => a + b, 0);
        const top = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0];
        if (top && total > 0) {
          const c = clsById.get(top[0])!;
          sugestao = { id: c.id, path: c.path, dominancia: Math.round((top[1] / total) * 100) };
          if (!c.is_active) {
            nfe.avisos.push(`A classificação sugerida ("${c.path}") está inativa no cadastro — confirme ou escolha outra.`);
          }
        }
      }

      previews.push({
        arquivo: arq.nome,
        ok: true,
        chave: nfe.chave,
        numero: nfe.numero,
        serie: nfe.serie,
        emitNome: nfe.emitNome,
        emitFantasia: nfe.emitFantasia,
        emitCnpj: nfe.emitCnpj,
        emissao: nfe.emissao,
        natOp: nfe.natOp,
        itens: nfe.itens,
        valor: nfe.valor,
        cfops: nfe.cfops,
        avisos: nfe.avisos,
        parcelas: nfe.parcelas.map((p, i) => ({ ...p, parcela: `${i + 1}/${nfe.parcelas.length}` })),
        partner: { id: achado?.id ?? null, name: achado?.name ?? nfe.emitNome, novo: !achado },
        classification: sugestao,
        duplicada: dup?.length ? { parcelas: dup.length, descricao: dup[0].description } : undefined,
      });
    }

    return NextResponse.json({ previews });
  } catch (err) {
    return handleAuthError(err);
  }
}

// PUT — grava os lançamentos confirmados pelo usuário (1 por parcela)
export async function PUT(request: NextRequest) {
  try {
    const { workspaceId } = await getControladoriaContext(request);
    const body = await request.json();
    const itens: {
      chave: string; numero: string; emissao: string; emitNome: string; emitCnpj: string;
      partner_name: string; classification_id: string; bank_account_id?: string | null;
      parcelas: { nDup: string; dueDate: string; amount: number }[];
      avisos?: string[];
    }[] = Array.isArray(body.itens) ? body.itens : [];
    if (!itens.length) return NextResponse.json({ error: "nada a importar" }, { status: 400 });

    const supabase = createAdminClient();
    const nowIso = new Date().toISOString();

    const { data: batch } = await supabase
      .from("fin_import_batches")
      .insert({
        workspace_id: workspaceId,
        source: "import",
        filename: itens.length === 1 ? `NF${itens[0].numero}.xml` : `${itens.length} XMLs de NF-e`,
      })
      .select("id").single();

    const resultado: { chave: string; criados: number; erro?: string }[] = [];

    for (const item of itens) {
      try {
        // trava final contra duplicata (a prévia pode ter envelhecido)
        const { data: jaTem } = await supabase
          .from("fin_entries").select("id").eq("workspace_id", workspaceId)
          .is("deleted_at", null).ilike("observation", `%${item.chave}%`).limit(1);
        if (jaTem?.length) {
          resultado.push({ chave: item.chave, criados: 0, erro: "NF já lançada — ignorada" });
          continue;
        }

        const { data: cls } = await supabase
          .from("fin_classifications").select("id, flow, is_transfer, is_depreciation")
          .eq("workspace_id", workspaceId).eq("id", item.classification_id).single();
        if (!cls) { resultado.push({ chave: item.chave, criados: 0, erro: "classificação inválida" }); continue; }

        const { data: partner, error: pErr } = await supabase
          .from("fin_partners")
          .upsert({ workspace_id: workspaceId, name: String(item.partner_name).trim() }, { onConflict: "workspace_id,name" })
          .select("id, cpf_cnpj").single();
        if (pErr) throw pErr;
        // grava o CNPJ da NF no cadastro (só quando ainda não tem) — a partir
        // da próxima importação o match passa a ser por documento
        if (partner && !partner.cpf_cnpj && item.emitCnpj) {
          await supabase.from("fin_partners").update({ cpf_cnpj: item.emitCnpj }).eq("id", partner.id);
        }

        // Os avisos ficam registrados na observação, mas NÃO viram needs_review:
        // o motor EXCLUI needs_review da DRE (engine.ts), então marcar uma NF
        // legítima — que o usuário acabou de conferir e classificar na tela de
        // importação — faria o custo sumir do resultado silenciosamente.
        const obs = observacaoNf(item.chave) + (item.avisos?.length ? `\n⚠ ${item.avisos.join(" · ")}` : "");
        const rows = item.parcelas.map((p) => ({
          workspace_id: workspaceId,
          doc_number: null, // convenção do financeiro: a NF vai na descrição
          description: descricaoNf(item.numero),
          observation: obs.slice(0, 1000),
          partner_id: partner.id,
          classification_id: cls.id,
          bank_account_id: item.bank_account_id || null,
          competence_date: item.emissao,
          due_date: p.dueDate,
          paid_at: null,
          amount: Math.round(p.amount * 100) / 100,
          flow: cls.flow,
          kind: cls.is_transfer ? "transfer" : cls.is_depreciation ? "depreciation" : "normal",
          needs_review: false,
          source: "import", // nunca 'senseboard': o full-refresh do Sense apagaria
          source_created_at: nowIso,
          source_created_by: "import-xml",
          import_batch_id: batch?.id ?? null,
        }));

        const { data: criados, error } = await supabase.from("fin_entries").insert(rows).select("id");
        if (error) throw error;
        resultado.push({ chave: item.chave, criados: criados?.length ?? 0 });
      } catch (e) {
        resultado.push({ chave: item.chave, criados: 0, erro: e instanceof Error ? e.message : "erro ao gravar" });
      }
    }

    invalidateEngineCache(workspaceId);
    const total = resultado.reduce((a, r) => a + r.criados, 0);
    return NextResponse.json({ resultado, total, batch_id: batch?.id ?? null });
  } catch (err) {
    return handleAuthError(err);
  }
}

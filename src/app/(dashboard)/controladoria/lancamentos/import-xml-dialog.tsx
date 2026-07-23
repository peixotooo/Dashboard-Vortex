"use client";

import * as React from "react";
import { Loader2, AlertTriangle, FileUp, Check, X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { fmtDateBR } from "@/lib/controladoria/format";
import { SearchSelect, type Option } from "../search-select";
import { PartnerInput } from "../partner-input";

type Parcela = { nDup: string; dueDate: string; amount: number; parcela: string; estimada?: boolean };

type Preview = {
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
  parcelas?: Parcela[];
  partner?: { id: string | null; name: string; novo: boolean };
  classification?: { id: string | null; path: string | null; dominancia: number | null };
  duplicada?: { parcelas: number; descricao: string | null };
};

type Item = Preview & {
  incluir: boolean;
  partnerName: string;
  classificationId: string;
  bankAccountId: string;
};

/** Lê o XML respeitando a codificação declarada (ERPs antigos usam ISO-8859-1). */
async function lerXml(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const head = new TextDecoder("ascii").decode(buf.slice(0, 256));
  const enc = (head.match(/encoding=["']([\w-]+)["']/i)?.[1] ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(enc).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

export function ImportXmlDialog({
  open, onOpenChange, workspaceId, clsOptions, accOptions, onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workspaceId: string;
  clsOptions: Option[];
  accOptions: Option[];
  onImported: () => void;
}) {
  const [itens, setItens] = React.useState<Item[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [resultado, setResultado] = React.useState<{ total: number; falhas: string[] } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const reset = () => { setItens(null); setErro(null); setResultado(null); };

  const carregar = async (files: FileList | null) => {
    if (!files?.length || !workspaceId) return;
    setBusy(true); setErro(null); setResultado(null);
    try {
      const lista = Array.from(files).slice(0, 40);
      // o corpo da requisição tem teto (~4,5 MB na Vercel) — avisa antes de falhar
      const bytes = lista.reduce((a, f) => a + f.size, 0);
      if (bytes > 3_500_000) {
        throw new Error(
          `Os arquivos somam ${(bytes / 1_048_576).toFixed(1)} MB, acima do limite de envio. Importe em lotes menores.`
        );
      }
      const arquivos = await Promise.all(
        lista.map(async (f) => ({ nome: f.name, xml: await lerXml(f) }))
      );
      const res = await fetch("/api/controladoria/lancamentos/importar-xml", {
        method: "POST",
        headers: { "x-workspace-id": workspaceId, "Content-Type": "application/json" },
        body: JSON.stringify({ arquivos }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setItens(
        (json.previews as Preview[]).map((p) => ({
          ...p,
          incluir: p.ok && !p.duplicada,
          partnerName: p.partner?.name ?? "",
          classificationId: p.classification?.id ?? "",
          bankAccountId: "",
        }))
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao ler os arquivos");
    } finally {
      setBusy(false);
    }
  };

  const importar = async () => {
    if (!itens) return;
    const selecionados = itens.filter((i) => i.incluir && i.ok && i.classificationId && i.partnerName.trim());
    if (!selecionados.length) return;
    setBusy(true); setErro(null);
    try {
      const res = await fetch("/api/controladoria/lancamentos/importar-xml", {
        method: "PUT",
        headers: { "x-workspace-id": workspaceId, "Content-Type": "application/json" },
        body: JSON.stringify({
          itens: selecionados.map((i) => ({
            chave: i.chave, numero: i.numero, emissao: i.emissao,
            emitNome: i.emitNome, emitCnpj: i.emitCnpj,
            partner_name: i.partnerName.trim(),
            classification_id: i.classificationId,
            bank_account_id: i.bankAccountId || null,
            parcelas: i.parcelas ?? [],
            avisos: i.avisos ?? [],
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const falhas = (json.resultado as { chave: string; erro?: string }[]).filter((r) => r.erro).map((r) => r.erro!);
      setResultado({ total: json.total, falhas });
      setItens(null);
      onImported();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao importar");
    } finally {
      setBusy(false);
    }
  };

  const patch = (idx: number, p: Partial<Item>) =>
    setItens((prev) => prev?.map((it, i) => (i === idx ? { ...it, ...p } : it)) ?? null);

  const prontos = itens?.filter((i) => i.incluir && i.ok && i.classificationId && i.partnerName.trim()) ?? [];
  const totalSelecionado = prontos.reduce((a, i) => a + (i.valor ?? 0), 0);
  const totalParcelas = prontos.reduce((a, i) => a + (i.parcelas?.length ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar XML de NF-e</DialogTitle>
        </DialogHeader>

        {!itens && !resultado && (
          <div className="space-y-3">
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); void carregar(e.dataTransfer.files); }}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-10 text-center hover:bg-muted/40"
            >
              {busy ? <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /> : <FileUp className="h-7 w-7 text-muted-foreground" />}
              <div className="text-sm font-medium">Arraste os XMLs aqui ou clique para escolher</div>
              <div className="text-xs text-muted-foreground">
                NF-e modelo 55 de compra (até 40 arquivos). O sistema lê fornecedor, valor e as parcelas com seus vencimentos.
              </div>
            </div>
            <input
              ref={inputRef} type="file" accept=".xml,text/xml,application/xml" multiple hidden
              onChange={(e) => { void carregar(e.target.files); e.target.value = ""; }}
            />
          </div>
        )}

        {erro && (
          <div className="flex items-center gap-2 rounded-md border border-red-300 p-3 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {erro}
          </div>
        )}

        {resultado && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
              <Check className="h-4 w-4" /> {resultado.total} lançamento(s) criado(s) — pendentes, prontos para dar baixa.
            </div>
            {resultado.falhas.map((f, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border border-amber-300 p-2 text-xs text-amber-800 dark:text-amber-300">
                <Info className="h-3.5 w-3.5" /> {f}
              </div>
            ))}
          </div>
        )}

        {itens && (
          <div className="space-y-3">
            {itens.map((it, idx) => (
              <div key={idx} className={`rounded-lg border p-3 ${it.ok ? "" : "border-red-300 bg-red-50/40 dark:bg-red-950/10"}`}>
                {!it.ok ? (
                  <div className="flex items-start gap-2 text-sm">
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <div>
                      <div className="font-medium">{it.arquivo}</div>
                      <div className="text-red-700 dark:text-red-400">{it.erro}</div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox" className="mt-1" checked={it.incluir}
                          onChange={(e) => patch(idx, { incluir: e.target.checked })}
                        />
                        <span>
                          <span className="font-medium">
                            NF {it.numero}-{it.serie} · {it.emitFantasia || it.emitNome}
                          </span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            emissão {fmtDateBR(it.emissao ?? null)} · CFOP {it.cfops?.join(", ")} · {it.itens}
                          </span>
                        </span>
                      </label>
                      <span className="text-right">
                        <span className="text-base font-semibold tabular-nums">{formatCurrency(it.valor ?? 0)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {it.parcelas?.length} parcela{(it.parcelas?.length ?? 0) > 1 ? "s" : ""}
                        </span>
                      </span>
                    </div>

                    {it.duplicada && (
                      <div className="mt-2 flex items-center gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        Esta NF já está lançada ({it.duplicada.parcelas} parcela(s) como &quot;{it.duplicada.descricao}&quot;). Marque a caixa só se quiser lançar de novo.
                      </div>
                    )}
                    {it.avisos?.map((a, i) => (
                      <div key={i} className="mt-2 flex items-center gap-2 rounded border border-amber-300 p-2 text-xs text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {a}
                      </div>
                    ))}

                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="text-xs text-muted-foreground">
                          Parceiro {it.partner?.novo && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">NOVO</span>}
                        </label>
                        <PartnerInput value={it.partnerName} onChange={(v) => patch(idx, { partnerName: v })} />
                        {it.partner?.novo && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            Não achei no cadastro. Confirme a grafia ou escolha um existente para não duplicar.
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">
                          Classificação {it.classification?.dominancia != null && (
                            <span className="text-[11px]">(sugerida — {it.classification.dominancia}% do histórico)</span>
                          )}
                        </label>
                        <SearchSelect
                          value={it.classificationId}
                          onChange={(v) => patch(idx, { classificationId: v })}
                          options={clsOptions}
                          placeholder="Escolha a classificação"
                        />
                        {!it.classificationId && (
                          <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">Obrigatória para importar.</p>
                        )}
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Conta (opcional)</label>
                        <SearchSelect
                          value={it.bankAccountId}
                          onChange={(v) => patch(idx, { bankAccountId: v })}
                          options={accOptions}
                          placeholder="Sem conta"
                          clearable
                        />
                      </div>
                    </div>

                    <div className="mt-3 overflow-x-auto rounded border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="p-1.5 text-left font-medium">Parcela</th>
                            <th className="p-1.5 text-left font-medium">Vencimento</th>
                            <th className="p-1.5 text-right font-medium">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {it.parcelas?.map((p, i) => (
                            <tr key={i} className="border-t">
                              <td className="p-1.5">{p.parcela}</td>
                              <td className="p-1.5">
                                {fmtDateBR(p.dueDate)}
                                {p.estimada && <span className="ml-1 text-amber-700 dark:text-amber-400">(estimado)</span>}
                              </td>
                              <td className="p-1.5 text-right tabular-nums">{formatCurrency(p.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="items-center gap-2">
          {itens && (
            <span className="mr-auto text-sm text-muted-foreground">
              {prontos.length} nota(s) · {totalParcelas} lançamento(s) · {formatCurrency(totalSelecionado)}
            </span>
          )}
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
            {resultado ? "Fechar" : "Cancelar"}
          </Button>
          {itens && (
            <Button onClick={() => void importar()} disabled={busy || !prontos.length}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Importar {prontos.length || ""} nota{prontos.length === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

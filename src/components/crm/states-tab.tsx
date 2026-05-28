"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Users,
  DollarSign,
  Plus,
  RefreshCw,
  MessageCircle,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useWorkspace } from "@/lib/workspace-context";
import type { RfmCustomer } from "@/lib/crm-rfm";
import { StateTilemap, STATE_NAMES, type UF } from "./state-tilemap";

// Conteúdo da aba "Estados" no /crm. Mostra:
//   - Tilemap clicável dos 27 UFs (norte → sul, oeste → leste).
//   - Side panel com métricas do UF em destaque + ação de
//     criar/sincronizar lista pra campanha (POST materialize).
//
// Clique no tile faz duas coisas: vira o "highlight" do side panel
// E alterna no Set de filtros globais (compartilhado entre tabs).
// Por isso esse componente recebe stateFilter+onToggle do parent.

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function formatInt(v: number): string {
  return v.toLocaleString("pt-BR");
}

type ListInfo = {
  id: string;
  name: string;
  total: number;
} | null;

export function StatesTabContent({
  customers,
  customerStates,
  stateFilter,
  onToggle,
  onClear,
  onGoToCustomers,
}: {
  customers: RfmCustomer[];
  customerStates: Record<string, string>;
  stateFilter: Set<UF>;
  onToggle: (uf: UF) => void;
  onClear: () => void;
  onGoToCustomers: () => void;
}) {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? "";

  // Agrega por UF a partir da base atual (snapshot + lookup).
  const aggregateByUF = useMemo(() => {
    const agg: Record<string, { count: number; revenue: number }> = {};
    let unknown = 0;
    for (const c of customers) {
      const uf = c.state ?? customerStates[c.email];
      if (uf) {
        if (!agg[uf]) agg[uf] = { count: 0, revenue: 0 };
        agg[uf].count += 1;
        agg[uf].revenue += c.totalSpent ?? 0;
      } else {
        unknown += 1;
      }
    }
    return { agg, unknown };
  }, [customers, customerStates]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const [uf, v] of Object.entries(aggregateByUF.agg)) c[uf] = v.count;
    return c;
  }, [aggregateByUF]);

  const totalKnown = Object.values(aggregateByUF.agg).reduce((s, v) => s + v.count, 0);

  // Side panel mostra o último UF clicado/em foco. Quando nada
  // está selecionado, mostramos placeholder.
  const [focus, setFocus] = useState<UF | null>(null);

  function handleToggle(uf: UF) {
    setFocus(uf);
    onToggle(uf);
  }

  // Lista auto_segment do UF em foco — carregada lazy quando o
  // side panel troca de estado.
  const [list, setList] = useState<ListInfo>(null);
  const [listLoading, setListLoading] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sempre que focus muda, busca a lista
  useEffect(() => {
    if (!focus || !workspaceId) { setList(null); return; }
    let cancelled = false;
    setListLoading(true);
    fetch(`/api/crm/contact-lists`, { headers: { "x-workspace-id": workspaceId } })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const lists = (data.lists ?? []) as Array<{
          id: string; name: string; total_count: number;
          auto_segment: { type: string; state?: string } | null;
        }>;
        const match = lists.find((l) =>
          l.auto_segment?.type === "state" && l.auto_segment?.state === focus
        );
        setList(match ? { id: match.id, name: match.name, total: match.total_count } : null);
      })
      .catch(() => { /* swallow */ })
      .finally(() => { if (!cancelled) setListLoading(false); });
    return () => { cancelled = true; };
  }, [focus, workspaceId]);

  async function materialize(uf: UF) {
    setMaterializing(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/crm/segments/state/materialize", {
        method: "POST",
        headers: { "x-workspace-id": workspaceId, "Content-Type": "application/json" },
        body: JSON.stringify({ state: uf }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro");
      setList({ id: data.list.id, name: data.list.name, total: data.seed.appended + data.seed.duplicate });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Erro de rede");
    } finally {
      setMaterializing(false);
    }
  }

  const focusData = focus ? aggregateByUF.agg[focus] : null;

  return (
    <div className="space-y-4">
      {/* Header com contadores + ação rápida */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Clique num estado pra <span className="text-foreground font-medium">filtrar tudo</span> (RFM, comportamento, listagem de clientes) por aquela UF.
            Multi-select — clica de novo pra remover.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatInt(totalKnown)} clientes com estado identificado
            {aggregateByUF.unknown > 0 && (
              <span className="text-amber-400"> · {formatInt(aggregateByUF.unknown)} sem estado (CSV antigo)</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stateFilter.size > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={onClear}>
                Limpar seleção
              </Button>
              <Button size="sm" onClick={onGoToCustomers}>
                Ver clientes filtrados →
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Tilemap */}
        <Card>
          <CardContent className="p-6">
            <StateTilemap
              counts={counts}
              selected={stateFilter}
              onToggle={handleToggle}
              maxWidth={520}
            />
            <p className="text-[11px] text-muted-foreground mt-4 text-center">
              Layout aproximado por geografia (norte em cima, sul embaixo). Cor mais escura = mais clientes.
              Tile selecionado fica amarelo.
            </p>
          </CardContent>
        </Card>

        {/* Side panel */}
        <Card>
          <CardContent className="p-6">
            {!focus ? (
              <div className="text-center text-sm text-muted-foreground py-12">
                <p>Clique num estado pra ver detalhes.</p>
                <p className="text-xs mt-2">Os outros filtros do CRM (segmento, lifecycle, cupom, etc.) continuam ativos — você compõe com o estado.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h3 className="text-xl font-bold">{STATE_NAMES[focus]}</h3>
                  <p className="text-xs text-muted-foreground">
                    UF {focus}
                    {stateFilter.has(focus) && (
                      <span className="ml-2 text-amber-400">· no filtro ativo</span>
                    )}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border bg-card p-3">
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Users className="h-3 w-3" /> Clientes
                    </div>
                    <div className="text-2xl font-bold mt-1">
                      {formatInt(focusData?.count ?? 0)}
                    </div>
                  </div>
                  <div className="rounded-md border bg-card p-3">
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <DollarSign className="h-3 w-3" /> Receita
                    </div>
                    <div className="text-lg font-semibold mt-1">
                      {formatBRL(focusData?.revenue ?? 0)}
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4 space-y-3">
                  <div className="text-sm font-medium">Lista pra campanha</div>

                  {errorMsg && (
                    <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400 flex items-start gap-2">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  {listLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Checando...
                    </div>
                  ) : list ? (
                    <>
                      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                        <div className="flex items-center gap-2 text-emerald-300 font-medium">
                          <CheckCircle2 className="h-4 w-4" />
                          {list.name}
                        </div>
                        <p className="text-xs text-emerald-300/80 mt-1">
                          {formatInt(list.total)} contatos — cresce sozinho a cada pedido novo.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => materialize(focus)}
                          disabled={materializing}
                        >
                          {materializing
                            ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                            : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                          Re-sincronizar
                        </Button>
                        <a
                          href={`/crm/whatsapp?list=${list.id}`}
                          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border bg-background hover:bg-accent text-sm"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          WhatsApp
                        </a>
                      </div>
                    </>
                  ) : (focusData?.count ?? 0) === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Sem clientes neste estado.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Crie a lista auto-alimentada agora. A partir daí cada pedido novo deste estado entra automaticamente.
                      </p>
                      <Button size="sm" onClick={() => materialize(focus)} disabled={materializing}>
                        {materializing
                          ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          : <Plus className="h-4 w-4 mr-2" />}
                        Criar lista de {focus}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

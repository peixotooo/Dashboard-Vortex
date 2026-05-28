"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Map as MapIcon,
  Loader2,
  AlertCircle,
  MessageCircle,
  CheckCircle2,
  Users,
  DollarSign,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/lib/workspace-context";

// =================================================================
// Tile layout — UFs posicionadas em um grid 9x8 que aproxima geografia.
// Linha 1 (norte) → linha 9 (sul); colunas 1 (oeste) → 8 (leste).
// Não é mapa cartográfico real, mas dá o efeito "tilemap" + permite
// clicar em qualquer estado.
// =================================================================

type UF =
  | "AC" | "AL" | "AP" | "AM" | "BA" | "CE" | "DF" | "ES" | "GO" | "MA"
  | "MT" | "MS" | "MG" | "PA" | "PB" | "PR" | "PE" | "PI" | "RJ" | "RN"
  | "RS" | "RO" | "RR" | "SC" | "SP" | "SE" | "TO";

const POSITIONS: Record<UF, [number, number]> = {
  RR: [1, 4], AP: [1, 6],
  AM: [2, 3], PA: [2, 5], MA: [2, 6], CE: [2, 7], RN: [2, 8],
  AC: [3, 2], TO: [3, 5], PI: [3, 6], PB: [3, 7], PE: [3, 8],
  RO: [4, 2], MT: [4, 4], BA: [4, 6], AL: [4, 8],
  GO: [5, 4], DF: [5, 5], MG: [5, 6], ES: [5, 7], SE: [5, 8],
  MS: [6, 4], SP: [6, 6], RJ: [6, 7],
  PR: [7, 5],
  SC: [8, 5],
  RS: [9, 5],
};

const STATE_NAMES: Record<UF, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia",
  CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí",
  RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo",
  SE: "Sergipe", TO: "Tocantins",
};

const ALL_UFS = Object.keys(POSITIONS) as UF[];

// =================================================================

type StateRow = {
  state: string; // UF or "(sem estado)"
  customer_count: number;
  total_revenue: number;
  list: { id: string; name: string; total: number } | null;
};

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function formatInt(v: number): string {
  return v.toLocaleString("pt-BR");
}

/**
 * Escala logarítmica de cor (azul claro → azul escuro). Bulking
 * provavelmente vai ter SP dominante; log escala dá visibilidade
 * pros estados menores também.
 */
function colorIntensity(count: number, maxCount: number): string {
  if (count === 0 || maxCount === 0) return "bg-muted/30 border-muted/50";
  const ratio = Math.log(1 + count) / Math.log(1 + maxCount);
  if (ratio < 0.2) return "bg-sky-900/30 border-sky-800/60";
  if (ratio < 0.4) return "bg-sky-800/40 border-sky-700/60";
  if (ratio < 0.6) return "bg-sky-700/50 border-sky-600/60";
  if (ratio < 0.8) return "bg-sky-600/60 border-sky-500/60";
  return "bg-sky-500/70 border-sky-400/80";
}

export default function CrmEstadosPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? "";

  const [rows, setRows] = useState<StateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<UF | null>(null);
  const [materializing, setMaterializing] = useState(false);

  const wsHeaders = useCallback(
    (): HeadersInit => ({
      "x-workspace-id": workspaceId,
      "Content-Type": "application/json",
    }),
    [workspaceId]
  );

  const fetchSummary = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/crm/segments/state/summary", {
        headers: { "x-workspace-id": workspaceId },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro");
      setRows(data.states || []);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Erro de rede");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // Index pra lookup rápido por UF
  const byUF = useMemo(() => {
    const map = new Map<string, StateRow>();
    for (const r of rows) map.set(r.state, r);
    return map;
  }, [rows]);

  const maxCount = useMemo(() => {
    let max = 0;
    for (const r of rows) if (r.state !== "(sem estado)" && r.customer_count > max) max = r.customer_count;
    return max;
  }, [rows]);

  const semEstado = byUF.get("(sem estado)");
  const totalKnown = rows.reduce((s, r) => r.state !== "(sem estado)" ? s + r.customer_count : s, 0);

  const selectedRow = selected ? byUF.get(selected) : null;

  async function materialize(uf: UF) {
    setMaterializing(true);
    try {
      const res = await fetch("/api/crm/segments/state/materialize", {
        method: "POST",
        headers: wsHeaders(),
        body: JSON.stringify({ state: uf }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro");
      // Refresh
      await fetchSummary();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Erro de rede");
    } finally {
      setMaterializing(false);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MapIcon className="h-6 w-6" />
            Estados
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Clientes por UF do último pedido confirmado. Clique num estado pra ver detalhes e criar lista pra campanha.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchSummary} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Atualizar
        </Button>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* ===== Tilemap ===== */}
          <Card>
            <CardContent className="p-6">
              <div className="text-xs text-muted-foreground mb-3 flex items-center justify-between">
                <span>{formatInt(totalKnown)} clientes com estado identificado</span>
                {semEstado && (
                  <span className="text-amber-400">
                    + {formatInt(semEstado.customer_count)} sem estado
                  </span>
                )}
              </div>
              <div
                className="grid gap-1.5"
                style={{
                  gridTemplateRows: "repeat(9, minmax(0, 1fr))",
                  gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
                  aspectRatio: "8 / 9",
                  maxWidth: 480,
                  margin: "0 auto",
                }}
              >
                {ALL_UFS.map((uf) => {
                  const [row, col] = POSITIONS[uf];
                  const data = byUF.get(uf);
                  const count = data?.customer_count ?? 0;
                  const intensity = colorIntensity(count, maxCount);
                  const isSelected = selected === uf;
                  return (
                    <button
                      key={uf}
                      type="button"
                      onClick={() => setSelected(uf)}
                      style={{ gridRow: row, gridColumn: col }}
                      className={`
                        rounded-md border transition-all flex flex-col items-center justify-center p-1
                        ${intensity}
                        ${isSelected ? "ring-2 ring-amber-400 scale-105" : "hover:scale-105 hover:ring-1 hover:ring-sky-300"}
                      `}
                      title={`${STATE_NAMES[uf]} — ${formatInt(count)} clientes`}
                    >
                      <span className="text-xs font-semibold leading-none">{uf}</span>
                      <span className="text-[10px] leading-none mt-0.5 text-muted-foreground">
                        {count > 0 ? formatInt(count) : "—"}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground mt-4 text-center">
                Layout aproximado por geografia (norte em cima, sul embaixo). Cor mais escura = mais clientes.
              </p>
            </CardContent>
          </Card>

          {/* ===== Side panel ===== */}
          <Card>
            <CardContent className="p-6">
              {!selected || !selectedRow ? (
                <div className="text-center text-sm text-muted-foreground py-12">
                  <MapIcon className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p>Clique num estado pra ver detalhes.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-xl font-bold">{STATE_NAMES[selected]}</h2>
                    <p className="text-xs text-muted-foreground">UF {selected}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-md border bg-card p-3">
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Users className="h-3 w-3" /> Clientes
                      </div>
                      <div className="text-2xl font-bold mt-1">
                        {formatInt(selectedRow.customer_count)}
                      </div>
                    </div>
                    <div className="rounded-md border bg-card p-3">
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <DollarSign className="h-3 w-3" /> Receita
                      </div>
                      <div className="text-lg font-semibold mt-1">
                        {formatBRL(selectedRow.total_revenue)}
                      </div>
                    </div>
                  </div>

                  <div className="border-t pt-4 space-y-3">
                    <div className="text-sm font-medium">Lista pra campanha</div>
                    {selectedRow.list ? (
                      <>
                        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                          <div className="flex items-center gap-2 text-emerald-300 font-medium">
                            <CheckCircle2 className="h-4 w-4" />
                            {selectedRow.list.name}
                          </div>
                          <p className="text-xs text-emerald-300/80 mt-1">
                            {formatInt(selectedRow.list.total)} contatos — alimentada automaticamente a cada pedido novo.
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => materialize(selected)}
                            disabled={materializing}
                            title="Sincroniza com pedidos novos que entraram desde a última materialização"
                          >
                            {materializing ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                            )}
                            Re-sincronizar
                          </Button>
                          <a
                            href={`/crm/whatsapp?list=${selectedRow.list.id}`}
                            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border bg-background hover:bg-accent text-sm"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            Usar no WhatsApp
                          </a>
                        </div>
                      </>
                    ) : selectedRow.customer_count === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Sem clientes neste estado — nada pra segmentar ainda.
                      </p>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground">
                          Crie a lista auto-alimentada agora pra usar em campanha. A partir daí, cada pedido confirmado deste estado entra automaticamente.
                        </p>
                        <Button
                          size="sm"
                          onClick={() => materialize(selected)}
                          disabled={materializing}
                        >
                          {materializing ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Plus className="h-4 w-4 mr-2" />
                          )}
                          Criar lista de {selected}
                        </Button>
                      </>
                    )}
                  </div>

                  <div className="border-t pt-4">
                    <Badge variant="outline" className="text-[10px]">
                      Top {rows
                        .filter((r) => r.state !== "(sem estado)")
                        .findIndex((r) => r.state === selected) + 1}
                      {" "}de {rows.filter((r) => r.state !== "(sem estado)").length}
                    </Badge>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

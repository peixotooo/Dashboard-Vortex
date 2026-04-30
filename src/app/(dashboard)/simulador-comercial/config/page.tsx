"use client";

import React, { useEffect, useState } from "react";
import { SlidersHorizontal, Save, RotateCcw, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfigField } from "@/components/dashboard/config-field";
import { useWorkspace } from "@/lib/workspace-context";

const DEFAULTS = {
  piso_margem_pct: 15,
  buffer_zona_verde_pct: 5,
  custo_frete_medio_brl: 25,
  ticket_minimo_frete_gratis_brl: 199,
};

export default function CommercialSimulatorConfigPage() {
  const { workspace, userRole } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isDefault, setIsDefault] = useState(true);

  const [pisoMargemPct, setPisoMargemPct] = useState(DEFAULTS.piso_margem_pct);
  const [bufferZonaVerdePct, setBufferZonaVerdePct] = useState(DEFAULTS.buffer_zona_verde_pct);
  const [custoFreteMedioBrl, setCustoFreteMedioBrl] = useState(DEFAULTS.custo_frete_medio_brl);
  const [ticketMinimoFreteGratisBrl, setTicketMinimoFreteGratisBrl] = useState(
    DEFAULTS.ticket_minimo_frete_gratis_brl
  );

  const isAdmin = userRole === "owner" || userRole === "admin";

  useEffect(() => {
    if (!workspace?.id) return;

    async function fetchSettings() {
      setLoading(true);
      try {
        const res = await fetch("/api/simulador-comercial/settings", {
          headers: { "x-workspace-id": workspace!.id },
        });
        const data = await res.json();
        setPisoMargemPct(data.piso_margem_pct ?? DEFAULTS.piso_margem_pct);
        setBufferZonaVerdePct(data.buffer_zona_verde_pct ?? DEFAULTS.buffer_zona_verde_pct);
        setCustoFreteMedioBrl(data.custo_frete_medio_brl ?? DEFAULTS.custo_frete_medio_brl);
        setTicketMinimoFreteGratisBrl(
          data.ticket_minimo_frete_gratis_brl ?? DEFAULTS.ticket_minimo_frete_gratis_brl
        );
        setIsDefault(data.isDefault ?? true);
      } catch {
        // Keep defaults
      } finally {
        setLoading(false);
      }
    }

    fetchSettings();
  }, [workspace?.id]);

  async function handleSave() {
    if (!workspace?.id || !isAdmin) return;
    setSaving(true);
    try {
      const res = await fetch("/api/simulador-comercial/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspace.id,
        },
        body: JSON.stringify({
          piso_margem_pct: pisoMargemPct,
          buffer_zona_verde_pct: bufferZonaVerdePct,
          custo_frete_medio_brl: custoFreteMedioBrl,
          ticket_minimo_frete_gratis_brl: ticketMinimoFreteGratisBrl,
        }),
      });
      if (res.ok) {
        setSaved(true);
        setIsDefault(false);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch {
      // Ignore
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setPisoMargemPct(DEFAULTS.piso_margem_pct);
    setBufferZonaVerdePct(DEFAULTS.buffer_zona_verde_pct);
    setCustoFreteMedioBrl(DEFAULTS.custo_frete_medio_brl);
    setTicketMinimoFreteGratisBrl(DEFAULTS.ticket_minimo_frete_gratis_brl);
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <SlidersHorizontal className="h-6 w-6 text-primary" />
            Configurações do Simulador Comercial
          </h1>
        </div>
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <Lock className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">Acesso restrito</p>
              <p className="text-sm text-muted-foreground mt-1">
                Apenas owner ou admin do workspace podem editar essas configurações. Peça pro responsável.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <SlidersHorizontal className="h-6 w-6 text-primary" />
            Configurações do Simulador Comercial
          </h1>
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <SlidersHorizontal className="h-6 w-6 text-primary" />
            Configurações do Simulador Comercial
          </h1>
          <p className="text-sm text-muted-foreground">
            Piso de margem, zonas e custo de frete usados pelo simulador
            {isDefault && (
              <span className="ml-2 text-xs text-warning">(usando padrões — salve para personalizar)</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent transition-colors cursor-pointer"
          >
            <RotateCcw className="h-4 w-4" />
            Restaurar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Save className="h-4 w-4" />
            {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Piso de margem e zonas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <ConfigField
              label="Piso de margem"
              value={pisoMargemPct}
              onChange={setPisoMargemPct}
              step={0.5}
              suffix="%"
              hint="Margem mínima sobre preço líquido. Abaixo disso, simulação fica vermelha."
            />
            <ConfigField
              label="Buffer zona verde"
              value={bufferZonaVerdePct}
              onChange={setBufferZonaVerdePct}
              step={0.5}
              suffix="%"
              hint={`Zona verde a partir de ${(pisoMargemPct + bufferZonaVerdePct).toFixed(1)}%. Entre piso e isso, fica amarela.`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Frete</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <ConfigField
              label="Custo médio de frete"
              value={custoFreteMedioBrl}
              onChange={setCustoFreteMedioBrl}
              step={1}
              prefix="R$"
              hint="Valor absorvido por venda quando 'frete grátis' está ativo no simulador."
            />
            <ConfigField
              label="Ticket mínimo para frete grátis"
              value={ticketMinimoFreteGratisBrl}
              onChange={setTicketMinimoFreteGratisBrl}
              step={10}
              prefix="R$"
              hint="Exibido como referência no simulador (não bloqueia simulação)."
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Como funciona</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <span className="inline-block w-3 h-3 rounded-full bg-emerald-500 mr-2" />
            <strong className="text-foreground">Verde</strong> — margem ≥ {(pisoMargemPct + bufferZonaVerdePct).toFixed(1)}%. Time pode aplicar sem consultar.
          </p>
          <p>
            <span className="inline-block w-3 h-3 rounded-full bg-yellow-500 mr-2" />
            <strong className="text-foreground">Amarela</strong> — margem entre {pisoMargemPct.toFixed(1)}% e {(pisoMargemPct + bufferZonaVerdePct).toFixed(1)}%. Só com gatilho registrado (queima, campanha datada, lançamento, etc.).
          </p>
          <p>
            <span className="inline-block w-3 h-3 rounded-full bg-red-500 mr-2" />
            <strong className="text-foreground">Vermelha</strong> — margem &lt; {pisoMargemPct.toFixed(1)}%. Bloqueia simulação. Sistema sugere caminhos pra recuperar margem.
          </p>
          <p className="pt-2 text-xs">
            CMV, impostos e outras despesas vêm do <strong>Configurações Financeiras</strong> (do simulador financeiro). Comissão de canal e custo unitário por SKU ficam pra fatia futura.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

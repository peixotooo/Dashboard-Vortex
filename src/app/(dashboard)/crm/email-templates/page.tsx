"use client";
import { useEffect, useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/lib/workspace-context";
import { SuggestionCard } from "./components/suggestion-card";
import { HistoryTable } from "./components/history-table";
import { SettingsDrawer } from "./components/settings-drawer";
import { SectionNav } from "./_components/section-nav";
import { AIComposeDialog } from "./_components/ai-compose-dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw, Loader2 } from "lucide-react";
import type { EmailSuggestion } from "@/lib/email-templates/types";

export default function EmailTemplatesPage() {
  const { workspace, userRole } = useWorkspace();
  const workspaceId = workspace?.id || "";
  const isAdmin = userRole === "owner" || userRole === "admin";
  const [items, setItems] = useState<EmailSuggestion[]>([]);
  const [date, setDate] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const r = await fetch("/api/crm/email-templates/active", {
        headers: { "x-workspace-id": workspaceId },
      });
      const d = await r.json();
      setItems(d.suggestions ?? []);
      setDate(d.date ?? "");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const generateNow = async () => {
    if (!workspaceId || generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      const r = await fetch("/api/crm/email-templates/generate-now", {
        method: "POST",
        headers: { "x-workspace-id": workspaceId },
      });
      const d = await r.json();
      if (!r.ok) {
        throw new Error(d.error ?? "Falha ao gerar sugestões.");
      }
      await reload();
      if (
        Array.isArray(d.slots_filled) &&
        d.slots_filled.length === 0 &&
        Array.isArray(d.slots_skipped) &&
        d.slots_skipped.length > 0
      ) {
        const reasons = (d.slots_skipped as Array<{ slot: number; reason: string }>)
          .map((s) => `slot ${s.slot}: ${s.reason}`)
          .join(" · ");
        setGenError(`Nenhum slot pôde ser gerado — ${reasons}`);
      }
    } catch (err) {
      setGenError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  if (!workspaceId) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <p className="text-muted-foreground">Selecione um workspace.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <SectionNav />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Email Templates</h1>
          <p className="text-muted-foreground text-sm">
            {items.length} sugestão{items.length === 1 ? "" : "ões"} prontas pra hoje · {date}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setAiOpen(true)}
            className="gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Criar com IA
          </Button>
          {isAdmin && <SettingsDrawer workspaceId={workspaceId} />}
        </div>
      </div>
      <AIComposeDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        workspaceId={workspaceId}
      />
      <Tabs defaultValue="today">
        <TabsList>
          <TabsTrigger value="today">Hoje</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="today" className="space-y-4">
          {loading && <div>Carregando...</div>}
          {!loading && items.length === 0 && (
            <div className="border rounded p-8 flex flex-col items-center gap-3 text-center">
              <div className="text-sm font-medium">Nenhuma sugestão pra hoje</div>
              <p className="text-xs text-muted-foreground max-w-md">
                O cron diário gera as 3 sugestões às 06:00 BRT, e um safety-net
                roda a cada hora. Você também pode disparar manualmente — refresca
                o catálogo VNDA e gera as 3 sugestões na hora.
              </p>
              <Button
                onClick={generateNow}
                disabled={generating}
                size="sm"
                className="gap-1.5 mt-1"
              >
                {generating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                {generating ? "Gerando... (~30-60s)" : "Gerar sugestões agora"}
              </Button>
              {genError && (
                <div className="text-[11px] text-destructive max-w-md">
                  {genError}
                </div>
              )}
            </div>
          )}
          {!loading && items.length > 0 && items.length < 3 && (
            <div className="border rounded-md p-3 flex items-center gap-3 bg-muted/40">
              <div className="text-xs flex-1">
                Só {items.length} de 3 sugestões pra hoje. Faltam slots —
                clique pra completar.
              </div>
              <Button
                onClick={generateNow}
                disabled={generating}
                size="sm"
                variant="outline"
                className="gap-1.5"
              >
                {generating ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                {generating ? "Gerando..." : "Completar"}
              </Button>
            </div>
          )}
          {genError && items.length > 0 && (
            <div className="text-[11px] text-destructive">{genError}</div>
          )}
          {items.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              onChanged={reload}
              workspaceId={workspaceId}
            />
          ))}
        </TabsContent>
        <TabsContent value="history">
          <HistoryTable workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

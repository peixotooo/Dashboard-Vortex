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
import { Sparkles } from "lucide-react";
import type { EmailSuggestion } from "@/lib/email-templates/types";

export default function EmailTemplatesPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id || "";
  const [items, setItems] = useState<EmailSuggestion[]>([]);
  const [date, setDate] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);

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
          <SettingsDrawer workspaceId={workspaceId} />
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
            <div className="border rounded p-8 text-center text-muted-foreground">
              Nenhuma sugestão pra hoje. Verifique se a feature está ativada em Configurações
              e se o cron já rodou (06:00 BRT).
            </div>
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

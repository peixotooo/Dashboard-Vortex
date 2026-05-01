"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, ExternalLink, Maximize2 } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";

interface LayoutMeta {
  id: string;
  pattern_name: string;
  reference_image: string;
  mode: "light" | "dark";
  slots: number[];
  product_count: number;
}

interface PreviewResp {
  id: string;
  slot: number;
  html: string;
}

const SLOT_LABEL: Record<number, string> = {
  1: "Best-seller",
  2: "Sem-giro",
  3: "Novidade",
};

function PreviewCard({
  layout,
  workspaceId,
}: {
  layout: LayoutMeta;
  workspaceId: string;
}) {
  const [slot, setSlot] = useState<number>(layout.slots[0]);
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/crm/email-templates/layouts/${layout.id}/preview?slot=${slot}`, {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d: PreviewResp) => setHtml(d.html ?? ""))
      .finally(() => setLoading(false));
  }, [layout.id, slot, workspaceId]);

  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="p-4 border-b flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={layout.mode === "dark" ? "default" : "outline"}>
              {layout.mode}
            </Badge>
            <Badge variant="secondary" className="font-mono text-xs">
              {layout.id}
            </Badge>
          </div>
          <div className="font-semibold truncate">{layout.pattern_name}</div>
          <div className="text-xs text-muted-foreground mt-1 truncate">
            ref: {layout.reference_image}
          </div>
        </div>
        <div className="flex flex-col gap-2 items-end">
          <Select value={String(slot)} onValueChange={(v) => setSlot(parseInt(v, 10))}>
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {layout.slots.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  Slot {s} · {SLOT_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Sheet>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1">
                <Maximize2 className="w-3 h-3" /> Tela cheia
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-3xl p-0">
              {loading ? (
                <div className="p-6">Carregando...</div>
              ) : (
                <iframe
                  srcDoc={html}
                  className="w-full h-full border-0"
                  sandbox=""
                  title={`Preview ${layout.id} slot ${slot}`}
                />
              )}
            </SheetContent>
          </Sheet>
        </div>
      </div>
      <div
        className="bg-neutral-100 flex items-start justify-center"
        style={{ height: 520 }}
      >
        {loading ? (
          <div className="p-6 text-muted-foreground text-sm">Carregando preview...</div>
        ) : (
          <iframe
            srcDoc={html}
            className="w-full h-full border-0 bg-white"
            sandbox=""
            title={`Preview ${layout.id} slot ${slot}`}
            style={{ transform: "scale(0.85)", transformOrigin: "top center" }}
          />
        )}
      </div>
    </Card>
  );
}

export default function LayoutLibraryPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? "";
  const [layouts, setLayouts] = useState<LayoutMeta[]>([]);
  const [filter, setFilter] = useState<"all" | "light" | "dark">("all");

  useEffect(() => {
    if (!workspaceId) return;
    fetch("/api/crm/email-templates/layouts", {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d) => setLayouts(d.layouts ?? []));
  }, [workspaceId]);

  const filtered = useMemo(
    () => (filter === "all" ? layouts : layouts.filter((l) => l.mode === filter)),
    [layouts, filter]
  );

  if (!workspaceId) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <p className="text-muted-foreground">Selecione um workspace.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            href="/crm/email-templates"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="w-3 h-3" /> Voltar para sugestões
          </Link>
          <h1 className="text-2xl font-bold">Biblioteca de layouts</h1>
          <p className="text-muted-foreground text-sm">
            {layouts.length} variações disponíveis. O cron escolhe um layout por dia (workspace + data + slot)
            via hash determinístico.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as "all" | "light" | "dark")}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos modos</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" asChild>
            <a
              href="/docs/superpowers/specs/2026-05-01-email-layout-library-v2.md"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="w-4 h-4 mr-1" /> Spec v2
            </a>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filtered.map((layout) => (
          <PreviewCard key={layout.id} layout={layout} workspaceId={workspaceId} />
        ))}
        {filtered.length === 0 && (
          <div className="border rounded p-8 text-center text-muted-foreground col-span-full">
            Nenhum layout no filtro selecionado.
          </div>
        )}
      </div>
    </div>
  );
}

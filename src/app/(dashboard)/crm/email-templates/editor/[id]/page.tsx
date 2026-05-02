"use client";
import { useEffect, useMemo, useRef, useState, use } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useWorkspace } from "@/lib/workspace-context";
import {
  defaultBlock,
  newId,
  type BlockNode,
  type BlockType,
  type DraftMeta,
  type Draft,
  type LogoConfig,
} from "@/lib/email-templates/editor/schema";
import { applyProductToBlocks } from "@/lib/email-templates/editor/apply-product";
import {
  ArrowLeft,
  Save,
  Copy as CopyIcon,
  Check,
  Loader2,
  Settings2,
  Code2,
  RefreshCw,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Palette } from "./_components/palette";
import { SortableBlock } from "./_components/sortable-block";
import { Inspector, LogoInspector } from "./_components/inspector";
import { TemplateModeEditor } from "./_components/template-mode-editor";
import type { PickedProduct } from "./_components/product-picker";
import type { TemplateData } from "@/lib/email-templates/editor/schema";

interface PageProps {
  params: Promise<{ id: string }>;
}

const LOGO_TOKEN = "__logo__";

export default function EmailEditorPage({ params }: PageProps) {
  const { id } = use(params);
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? "";

  const [draft, setDraft] = useState<Draft | null>(null);
  const [blocks, setBlocks] = useState<BlockNode[]>([]);
  const [meta, setMeta] = useState<DraftMeta>({ subject: "", preview: "", mode: "light" });
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [html, setHtml] = useState<string>("");
  const [renderLoading, setRenderLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Load draft
  useEffect(() => {
    if (!workspaceId) return;
    fetch(`/api/crm/email-templates/drafts/${id}`, {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d: { draft?: Draft }) => {
        if (d.draft) {
          setDraft(d.draft);
          setBlocks(d.draft.blocks);
          setMeta(d.draft.meta);
          setName(d.draft.name);
        }
      });
  }, [id, workspaceId]);

  // Render preview (debounced) on any block/meta change. editor=1 injects
  // the click-handler script into the iframe.
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!workspaceId || !draft) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setRenderLoading(true);
      try {
        const r = await fetch(`/api/crm/email-templates/drafts/${id}/render?editor=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId },
          body: JSON.stringify({ meta, blocks, layout_id: draft.layout_id }),
        });
        const d = await r.json();
        setHtml(d.html ?? "");
      } finally {
        setRenderLoading(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [blocks, meta, id, workspaceId, draft]);

  // Listen for clicks inside the iframe.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (!e.data || e.data.type !== "block:select") return;
      setSelectedId(e.data.id ?? null);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Push selection back into the iframe so the visual selection persists
  // across re-renders / outline-only selections.
  useEffect(() => {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;
    w.postMessage({ type: "block:set-selected", id: selectedId }, "*");
  }, [selectedId, html]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setBlocks((items) => {
      const oldIndex = items.findIndex((b) => b.id === active.id);
      const newIndex = items.findIndex((b) => b.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return items;
      return arrayMove(items, oldIndex, newIndex);
    });
  };

  const duplicateBlock = (blockId: string) => {
    setBlocks((b) => {
      const idx = b.findIndex((blk) => blk.id === blockId);
      if (idx === -1) return b;
      const clone = { ...b[idx], id: newId() } as BlockNode;
      const out = [...b];
      out.splice(idx + 1, 0, clone);
      return out;
    });
  };

  const addBlock = (type: BlockType) => {
    const node = defaultBlock(type);
    setBlocks((b) => [...b, node]);
    setSelectedId(node.id);
  };

  const pickProduct = (p: PickedProduct) => {
    setBlocks((current) => applyProductToBlocks(current, p));
  };

  const updateBlock = (blockId: string, patch: Partial<BlockNode>) => {
    setBlocks((b) =>
      b.map((blk) => (blk.id === blockId ? ({ ...blk, ...patch } as BlockNode) : blk))
    );
  };

  const removeBlock = (blockId: string) => {
    setBlocks((b) => b.filter((blk) => blk.id !== blockId));
    if (selectedId === blockId) setSelectedId(null);
  };

  const updateLogo = (next: LogoConfig | null) => {
    setMeta((m) => ({ ...m, logo: next }));
  };

  const save = async () => {
    if (!workspaceId) return;
    setSaving(true);
    try {
      await fetch(`/api/crm/email-templates/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId },
        body: JSON.stringify({ name, meta, blocks }),
      });
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  };

  const [htmlSheetOpen, setHtmlSheetOpen] = useState(false);
  const [htmlContent, setHtmlContent] = useState("");
  const [htmlLoading, setHtmlLoading] = useState(false);

  const fetchCleanHtml = async (): Promise<string | null> => {
    if (!workspaceId) return null;
    const r = await fetch(`/api/crm/email-templates/drafts/${id}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId },
      body: JSON.stringify({ meta, blocks, layout_id: draft?.layout_id }),
    });
    const d = await r.json();
    return d.html ?? null;
  };

  const openHtmlPanel = async () => {
    setHtmlLoading(true);
    setHtmlSheetOpen(true);
    try {
      const fresh = await fetchCleanHtml();
      if (fresh) {
        setHtmlContent(fresh);
        try {
          await navigator.clipboard.writeText(fresh);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // clipboard API can fail silently in some embed contexts
        }
      }
    } finally {
      setHtmlLoading(false);
    }
  };

  const regenerateHtml = async () => {
    setHtmlLoading(true);
    try {
      const fresh = await fetchCleanHtml();
      if (fresh) setHtmlContent(fresh);
    } finally {
      setHtmlLoading(false);
    }
  };

  const copyCurrentHtml = async () => {
    try {
      await navigator.clipboard.writeText(htmlContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  };

  const selectedBlock = useMemo(
    () => blocks.find((b) => b.id === selectedId) ?? null,
    [blocks, selectedId]
  );
  const isLogoSelected = selectedId === LOGO_TOKEN;
  const isTemplateMode = meta.render_mode === "template" && !!meta.template_data;
  const updateTemplateData = (next: TemplateData) => {
    setMeta((m) => ({
      ...m,
      template_data: next,
      // Mirror copy fields up so the cards/listing surfaces stay coherent.
      subject: next.copy.subject || m.subject,
      preview: next.copy.preview || m.preview,
    }));
  };

  if (!workspaceId) {
    return <div className="p-6 text-muted-foreground">Selecione um workspace.</div>;
  }
  if (!draft) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando draft...
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-card">
        <a
          href="/crm/email-templates/drafts"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3 h-3" /> Meus templates
        </a>
        <span className="w-px h-5 bg-border" />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 max-w-sm font-medium"
          placeholder="Nome do draft"
        />
        <div className="ml-auto flex items-center gap-2">
          {savedAt && (
            <span className="text-[11px] text-muted-foreground">
              salvo {savedAt.toLocaleTimeString()}
            </span>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Settings2 className="w-3.5 h-3.5" />
                Configurações
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="end">
              <div className="space-y-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Configurações gerais
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Subject</Label>
                  <Input
                    value={meta.subject}
                    onChange={(e) => setMeta((m) => ({ ...m, subject: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Preview text</Label>
                  <Input
                    value={meta.preview}
                    onChange={(e) => setMeta((m) => ({ ...m, preview: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Modo</Label>
                  <Select
                    value={meta.mode}
                    onValueChange={(v) =>
                      setMeta((m) => ({ ...m, mode: v as "light" | "dark" }))
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Button size="sm" variant="outline" onClick={openHtmlPanel} className="gap-1.5">
            <Code2 className="w-3.5 h-3.5" />
            HTML
          </Button>
          <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salvar
          </Button>
        </div>
      </div>

      {/* 3-pane layout */}
      <div className="flex-1 grid grid-cols-[220px_1fr_320px] min-h-0">
        {/* left: tabs — adicionar (palette) | estrutura (drag-and-drop) */}
        {/* In template mode, the blocks panel is hidden because edits flow
            through the template form on the right. */}
        {isTemplateMode ? (
          <aside className="border-r bg-card overflow-y-auto p-4">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              Modo template
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">
              Esse draft está renderizando o layout original{" "}
              <span className="font-mono">{draft.layout_id}</span>. Edite os
              textos e produto no painel à direita — a identidade visual do
              template é preservada.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => {
                if (
                  !window.confirm(
                    "Trocar pra modo blocos descarta a fidelidade visual do layout original. Continuar?"
                  )
                )
                  return;
                setMeta((m) => ({ ...m, render_mode: "blocks" }));
              }}
            >
              Customizar livremente (modo blocos)
            </Button>
          </aside>
        ) : (
          <aside className="border-r bg-card overflow-y-auto">
            <Tabs defaultValue="add" className="h-full flex flex-col">
              <TabsList className="grid grid-cols-2 m-3 mb-0 h-8">
                <TabsTrigger value="add" className="text-xs">
                  Adicionar
                </TabsTrigger>
                <TabsTrigger value="structure" className="text-xs">
                  Estrutura
                </TabsTrigger>
              </TabsList>
              <TabsContent value="add" className="p-3 mt-0 flex-1">
                <Palette onAdd={addBlock} />
                <div className="mt-6 px-1 text-[11px] text-muted-foreground/80 leading-relaxed">
                  Clique em qualquer elemento do email à direita para editar.
                </div>
              </TabsContent>
              <TabsContent value="structure" className="p-3 mt-0 flex-1">
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground px-1">
                    {blocks.length} blocos · arraste pra reordenar
                  </div>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={onDragEnd}
                  >
                    <SortableContext
                      items={blocks.map((b) => b.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-1.5">
                        {blocks.map((b) => (
                          <SortableBlock
                            key={b.id}
                            block={b}
                            selected={selectedId === b.id}
                            onSelect={() => setSelectedId(b.id)}
                            onDuplicate={() => duplicateBlock(b.id)}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              </TabsContent>
            </Tabs>
          </aside>
        )}

        {/* center: clickable live preview */}
        <main className="bg-neutral-100 dark:bg-neutral-900 overflow-y-auto p-6 relative">
          {renderLoading && (
            <div className="absolute right-8 top-8 z-10 flex items-center gap-1.5 bg-card/90 backdrop-blur px-2 py-1 rounded text-[10px] text-muted-foreground border">
              <Loader2 className="w-3 h-3 animate-spin" /> Renderizando
            </div>
          )}
          <Card className="max-w-[640px] mx-auto overflow-hidden shadow-lg">
            <iframe
              ref={iframeRef}
              srcDoc={html}
              className="w-full border-0 bg-white"
              sandbox="allow-scripts"
              title="Preview"
              style={{ height: "calc(100vh - 9rem)" }}
            />
          </Card>
        </main>

        {/* right: in template mode, the form-based editor; in block mode, the
            per-block inspector. */}
        <aside className="border-l bg-card overflow-y-auto p-4">
          {isTemplateMode && meta.template_data ? (
            <TemplateModeEditor
              data={meta.template_data}
              workspaceId={workspaceId}
              layoutId={draft.layout_id}
              onChange={updateTemplateData}
            />
          ) : isLogoSelected ? (
            <LogoInspector
              logo={meta.logo}
              onChange={(next) => updateLogo(next)}
              onRemove={() => updateLogo(null)}
            />
          ) : selectedBlock ? (
            <Inspector
              block={selectedBlock}
              workspaceId={workspaceId}
              onChange={(patch) => updateBlock(selectedBlock.id, patch)}
              onRemove={() => removeBlock(selectedBlock.id)}
              onPickProduct={pickProduct}
            />
          ) : (
            <div className="text-xs text-muted-foreground leading-relaxed">
              <p className="mb-2">Clique em um bloco no email pra editar.</p>
              <p>Ou adicione um novo bloco pelo painel à esquerda.</p>
            </div>
          )}
        </aside>
      </div>

      {/* HTML view + editable code panel */}
      <Sheet open={htmlSheetOpen} onOpenChange={setHtmlSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-3xl p-0 flex flex-col">
          <div className="flex items-center gap-2 px-4 py-3 border-b">
            <Code2 className="w-4 h-4 text-muted-foreground" />
            <SheetTitle className="text-sm font-medium">HTML do email</SheetTitle>
            {htmlLoading && (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={regenerateHtml}
                disabled={htmlLoading}
                className="gap-1.5"
                title="Re-gera o HTML a partir dos blocos atuais (descarta edições manuais)"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Regerar
              </Button>
              <Button size="sm" onClick={copyCurrentHtml} className="gap-1.5">
                {copied ? <Check className="w-3.5 h-3.5" /> : <CopyIcon className="w-3.5 h-3.5" />}
                {copied ? "Copiado" : "Copiar"}
              </Button>
            </div>
          </div>
          <div className="px-4 pt-3 pb-1 text-[11px] text-muted-foreground leading-relaxed">
            Edite linhas livremente — cada "Copiar" leva o que está aqui na caixa.
            Mudanças no editor visual não voltam pra cá automaticamente; clique em
            "Regerar" pra puxar a versão atual dos blocos.
          </div>
          <textarea
            value={htmlContent}
            onChange={(e) => setHtmlContent(e.target.value)}
            spellCheck={false}
            className="flex-1 w-full px-4 py-3 font-mono text-[11px] leading-5 bg-neutral-950 text-neutral-100 border-0 outline-none resize-none"
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

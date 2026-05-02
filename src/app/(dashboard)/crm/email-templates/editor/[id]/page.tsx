"use client";
import { useEffect, useMemo, useRef, useState, use } from "react";
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
import { useWorkspace } from "@/lib/workspace-context";
import {
  defaultBlock,
  newId,
  type BlockNode,
  type BlockType,
  type DraftMeta,
  type Draft,
} from "@/lib/email-templates/editor/schema";
import { ArrowLeft, Save, Copy as CopyIcon, Check, Loader2 } from "lucide-react";
import { Palette } from "./_components/palette";
import { SortableBlock } from "./_components/sortable-block";
import { Inspector } from "./_components/inspector";

interface PageProps {
  params: Promise<{ id: string }>;
}

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

  // Render preview (debounced) on any block/meta change
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!workspaceId || !draft) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setRenderLoading(true);
      try {
        const r = await fetch(`/api/crm/email-templates/drafts/${id}/render`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId },
          body: JSON.stringify({ meta, blocks }),
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

  const addBlock = (type: BlockType) => {
    const node = defaultBlock(type);
    setBlocks((b) => [...b, node]);
    setSelectedId(node.id);
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

  const copyHtml = async () => {
    if (!html) return;
    await navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const selectedBlock = useMemo(
    () => blocks.find((b) => b.id === selectedId) ?? null,
    [blocks, selectedId]
  );

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
          href="/crm/email-templates/library"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3 h-3" /> Galeria
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
          <Button size="sm" variant="outline" onClick={copyHtml} className="gap-1.5">
            {copied ? <Check className="w-3.5 h-3.5" /> : <CopyIcon className="w-3.5 h-3.5" />}
            {copied ? "Copiado" : "Copiar HTML"}
          </Button>
          <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salvar
          </Button>
        </div>
      </div>

      {/* 3-pane layout */}
      <div className="flex-1 grid grid-cols-[260px_1fr_320px] min-h-0">
        {/* left: palette + outline */}
        <aside className="border-r bg-card overflow-y-auto p-4 space-y-6">
          <Palette onAdd={addBlock} />

          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Estrutura ({blocks.length})
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
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
        </aside>

        {/* center: live preview */}
        <main className="bg-neutral-100 dark:bg-neutral-900 overflow-y-auto p-6">
          <Card className="max-w-[640px] mx-auto overflow-hidden shadow-lg">
            {renderLoading && (
              <div className="absolute right-4 top-4 z-10 flex items-center gap-1.5 bg-card/90 backdrop-blur px-2 py-1 rounded text-[10px] text-muted-foreground border">
                <Loader2 className="w-3 h-3 animate-spin" /> Renderizando
              </div>
            )}
            <iframe
              srcDoc={html}
              className="w-full border-0 bg-white"
              sandbox=""
              title="Preview"
              style={{ height: "calc(100vh - 9rem)" }}
            />
          </Card>
        </main>

        {/* right: inspector */}
        <aside className="border-l bg-card overflow-y-auto p-4 space-y-5">
          <div className="space-y-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Geral
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
                onValueChange={(v) => setMeta((m) => ({ ...m, mode: v as "light" | "dark" }))}
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

          <div className="border-t -mx-4 px-4 pt-4">
            {selectedBlock ? (
              <Inspector
                block={selectedBlock}
                onChange={(patch) => updateBlock(selectedBlock.id, patch)}
                onRemove={() => removeBlock(selectedBlock.id)}
              />
            ) : (
              <div className="text-xs text-muted-foreground">
                Selecione um bloco na coluna da esquerda para editar.
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

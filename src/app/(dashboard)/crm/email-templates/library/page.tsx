"use client";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, Maximize2, Wand2, Search, X } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

interface Product {
  vnda_id: string;
  name: string;
  price: number;
  image_url: string;
}

const SLOT_LABEL: Record<number, string> = {
  1: "Best-seller",
  2: "Sem-giro",
  3: "Novidade",
};

const CATEGORY_META: Record<string, { label: string; description: string }> = {
  "ref-1-black-friday.jpg": {
    label: "Editorial overlay",
    description: "Tipografia gigante quebrando ao redor do hero.",
  },
  "ref-2-flaw-reviews.jpg": {
    label: "Reviews + hero",
    description: "Reviews na coluna esquerda, hero na direita.",
  },
  "ref-3-void-asym.jpg": {
    label: "Asymmetric narrative",
    description: "Logo + headline asimétricos com hero portrait.",
  },
  "ref-4-society-overlay.jpg": {
    label: "Hero full-bleed dual CTA",
    description: "Hero ocupa o frame, dois botões CTA.",
  },
  "ref-5-represent-edition.jpg": {
    label: "Edition narrative",
    description: "Mark + headline em 2 linhas + multi-shot.",
  },
  "ref-6-numbered-grid.jpg": {
    label: "Numbered 2×2 grid",
    description: "4 produtos com números em italic. Sem hero único.",
  },
  "ref-7-initial-3x3.jpg": {
    label: "Uniform 3×3 grid",
    description: "9 thumbnails uniformes.",
  },
  "ref-8-puffer-detail.jpg": {
    label: "Single product detail",
    description: "Produto dominante + 2-line name + paragraph.",
  },
  "ref-9-asics-slash.jpg": {
    label: "Slash labels",
    description: "Labels separados por `/` flutuando.",
  },
  "ref-10-faine-blur.jpg": {
    label: "Blur hero + bestsellers",
    description: "Hero atmosférico com row de bestsellers.",
  },
  "in-house": {
    label: "Classic editorial",
    description: "Layout padrão usado no cron diário.",
  },
};

function PreviewCard({
  layout,
  workspaceId,
  productId,
  slot,
  onOpen,
}: {
  layout: LayoutMeta;
  workspaceId: string;
  productId: string | null;
  slot: number;
  onOpen: (html: string) => void;
}) {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const effectiveSlot = layout.slots.includes(slot) ? slot : layout.slots[0];
  const category = CATEGORY_META[layout.reference_image] ?? { label: layout.pattern_name };

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ slot: String(effectiveSlot), hero: "off" });
    if (productId) params.set("product_id", productId);
    fetch(`/api/crm/email-templates/layouts/${layout.id}/preview?${params}`, {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d: PreviewResp) => setHtml(d.html ?? ""))
      .finally(() => setLoading(false));
  }, [layout.id, effectiveSlot, workspaceId, productId]);

  return (
    <Card className="group overflow-hidden flex flex-col border-border hover:border-foreground/40 hover:shadow-lg transition-all">
      <div
        className="relative bg-neutral-100 dark:bg-neutral-900 flex items-start justify-center overflow-hidden"
        style={{ height: 360 }}
      >
        {loading ? (
          <div className="p-4 text-muted-foreground text-xs">Carregando...</div>
        ) : (
          <iframe
            srcDoc={html}
            className="w-full h-full border-0 bg-white pointer-events-none"
            sandbox=""
            title={`Preview ${layout.id} slot ${effectiveSlot}`}
            style={{ transform: "scale(0.6)", transformOrigin: "top center" }}
          />
        )}
        <button
          type="button"
          onClick={() => !loading && onOpen(html)}
          className="absolute inset-0 flex flex-col items-center justify-center bg-black/0 group-hover:bg-black/55 transition-colors backdrop-blur-0 group-hover:backdrop-blur-sm"
          aria-label={`Ampliar ${layout.pattern_name}`}
        >
          <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity mb-2" />
          <span className="text-white text-xs uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
            Ampliar
          </span>
        </button>
      </div>
      <div className="p-3 border-t flex items-center gap-2">
        <div className="flex flex-col min-w-0 flex-1">
          <div className="font-medium text-sm truncate">{category.label}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Badge
              variant={layout.mode === "dark" ? "default" : "outline"}
              className="text-[10px] px-1.5 h-4"
            >
              {layout.mode}
            </Badge>
            <span className="font-mono text-[10px] text-muted-foreground truncate">
              slot {effectiveSlot} · {SLOT_LABEL[effectiveSlot]}
            </span>
          </div>
        </div>
        <a
          href={`/crm/email-templates/compose/${layout.id}`}
          className="inline-flex items-center justify-center gap-1 h-8 px-3 text-xs font-semibold rounded bg-foreground text-background hover:opacity-90"
        >
          <Wand2 className="w-3 h-3" /> Usar
        </a>
      </div>
    </Card>
  );
}

function ProductPreviewPicker({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string;
  value: Product | null;
  onChange: (p: Product | null) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(
          `/api/crm/email-templates/vnda-search?q=${encodeURIComponent(q.trim())}`,
          { headers: { "x-workspace-id": workspaceId } }
        );
        const d = await r.json();
        setResults(d.products ?? []);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [q, workspaceId]);

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">Produto pra simular</Label>
      {value ? (
        <div className="flex items-center gap-2 border rounded p-2 max-w-sm bg-muted/30">
          <img src={value.image_url} alt={value.name} className="w-8 h-10 object-cover" />
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">{value.name}</div>
          </div>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onChange(null)}>
            <X className="w-3 h-3" />
          </Button>
        </div>
      ) : (
        <div className="relative max-w-sm">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar produto VNDA..."
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              className="h-8"
            />
          </div>
          {open && q.trim().length >= 2 && (
            <div className="absolute z-10 mt-1 w-full bg-background border rounded shadow max-h-72 overflow-y-auto">
              {loading && <div className="p-3 text-xs text-muted-foreground">Buscando...</div>}
              {!loading && results.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground">Nenhum produto.</div>
              )}
              {results.map((p) => (
                <button
                  key={p.vnda_id}
                  onClick={() => {
                    onChange(p);
                    setQ("");
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 p-2 hover:bg-muted text-left"
                >
                  <img src={p.image_url} alt={p.name} className="w-8 h-10 object-cover" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">R$ {p.price.toFixed(2)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type ModeFilter = "all" | "light" | "dark";

export default function LayoutLibraryPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? "";
  const [layouts, setLayouts] = useState<LayoutMeta[]>([]);
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [slot, setSlot] = useState<number>(1);
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null);
  const [lightboxHtml, setLightboxHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    fetch("/api/crm/email-templates/layouts", {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d) => setLayouts(d.layouts ?? []));
  }, [workspaceId]);

  // Auto-load a default sample product so previews aren't broken on first
  // visit. The user can override via the picker.
  useEffect(() => {
    if (!workspaceId || previewProduct) return;
    fetch("/api/crm/email-templates/vnda-search", {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d: { products?: Product[] }) => {
        const first = d.products?.[0];
        if (first) setPreviewProduct(first);
      })
      .catch(() => {});
  }, [workspaceId, previewProduct]);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    const order = [
      "ref-1-black-friday.jpg",
      "ref-2-flaw-reviews.jpg",
      "ref-3-void-asym.jpg",
      "ref-4-society-overlay.jpg",
      "ref-5-represent-edition.jpg",
      "ref-6-numbered-grid.jpg",
      "ref-7-initial-3x3.jpg",
      "ref-8-puffer-detail.jpg",
      "ref-9-asics-slash.jpg",
      "ref-10-faine-blur.jpg",
      "in-house",
    ];
    for (const l of layouts) seen.add(l.reference_image);
    return order.filter((k) => seen.has(k));
  }, [layouts]);

  const filtered = useMemo(() => {
    return layouts.filter((l) => {
      if (modeFilter !== "all" && l.mode !== modeFilter) return false;
      if (categoryFilter !== "all" && l.reference_image !== categoryFilter) return false;
      return true;
    });
  }, [layouts, modeFilter, categoryFilter]);

  if (!workspaceId) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <p className="text-muted-foreground">Selecione um workspace.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <a
            href="/crm/email-templates"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="w-3 h-3" /> Voltar para sugestões
          </a>
          <h1 className="text-2xl font-bold">Galeria de templates</h1>
          <p className="text-muted-foreground text-sm">
            {filtered.length} de {layouts.length} layouts. Selecione um produto pra renderizar
            todos os previews com peças reais do catálogo VNDA.
          </p>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <ProductPreviewPicker
            workspaceId={workspaceId}
            value={previewProduct}
            onChange={setPreviewProduct}
          />
          <Button variant="outline" asChild>
            <a
              href="/docs/superpowers/specs/2026-05-01-email-layout-library-v2.md"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="w-4 h-4 mr-1" /> Spec
            </a>
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-1">
            Modo
          </span>
          {(["all", "light", "dark"] as ModeFilter[]).map((m) => (
            <Button
              key={m}
              variant={modeFilter === m ? "default" : "outline"}
              size="sm"
              className="h-7 px-3 text-xs capitalize"
              onClick={() => setModeFilter(m)}
            >
              {m === "all" ? "Todos" : m}
            </Button>
          ))}
          <span className="w-px h-5 bg-border mx-2" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-1">
            Slot
          </span>
          {[1, 2, 3].map((s) => (
            <Button
              key={s}
              variant={slot === s ? "default" : "outline"}
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => setSlot(s)}
            >
              {SLOT_LABEL[s]}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-1">
            Categoria
          </span>
          <Button
            variant={categoryFilter === "all" ? "default" : "outline"}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => setCategoryFilter("all")}
          >
            Todas
          </Button>
          {categories.map((k) => {
            const meta = CATEGORY_META[k] ?? { label: k };
            return (
              <Button
                key={k}
                variant={categoryFilter === k ? "default" : "outline"}
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={() => setCategoryFilter(k)}
              >
                {meta.label}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((layout) => (
          <PreviewCard
            key={layout.id}
            layout={layout}
            workspaceId={workspaceId}
            productId={previewProduct?.vnda_id ?? null}
            slot={slot}
            onOpen={(html) => setLightboxHtml(html)}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="border rounded p-8 text-center text-muted-foreground">
          Nenhum layout no filtro selecionado.
        </div>
      )}

      <Sheet
        open={lightboxHtml !== null}
        onOpenChange={(open) => !open && setLightboxHtml(null)}
      >
        <SheetContent side="right" className="w-full sm:max-w-3xl p-0">
          <SheetTitle className="sr-only">Preview ampliado</SheetTitle>
          {lightboxHtml && (
            <iframe
              srcDoc={lightboxHtml}
              className="w-full h-full border-0"
              sandbox=""
              title="Preview ampliado"
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

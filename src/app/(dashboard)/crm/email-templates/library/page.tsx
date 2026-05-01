"use client";
import { useEffect, useMemo, useState } from "react";
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
import { ArrowLeft, ExternalLink, Maximize2, Wand2, Search, X } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
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

// Each layout's reference filename → human category name. Light/dark of the
// same pattern share a category.
const CATEGORY_META: Record<string, { label: string; description: string }> = {
  "ref-1-black-friday.jpg": {
    label: "Editorial overlay",
    description: "Tipografia gigante quebrando ao redor do hero. Inspiração: Black Friday templates.",
  },
  "ref-2-flaw-reviews.jpg": {
    label: "Reviews + hero",
    description: "Reviews na coluna esquerda, hero na direita. Inspiração: FLAW 2024.",
  },
  "ref-3-void-asym.jpg": {
    label: "Asymmetric narrative",
    description: "Logo + headline asimétricos com hero portrait. Inspiração: VOID Studios.",
  },
  "ref-4-society-overlay.jpg": {
    label: "Hero full-bleed dual CTA",
    description: "Hero ocupa o frame, dois botões CTA. Inspiração: Society Studios.",
  },
  "ref-5-represent-edition.jpg": {
    label: "Edition narrative",
    description: "Pequeno mark + headline em 2 linhas + paragráfo + multi-shot. Inspiração: REPRESENT.",
  },
  "ref-6-numbered-grid.jpg": {
    label: "Numbered 2×2 grid",
    description: "4 produtos com números em italic. Sem hero único.",
  },
  "ref-7-initial-3x3.jpg": {
    label: "Uniform 3×3 grid",
    description: "9 thumbnails uniformes. Inspiração: The Initial Collection.",
  },
  "ref-8-puffer-detail.jpg": {
    label: "Single product detail",
    description: "Produto dominante + 2-line name + paragraph. Inspiração: REPRESENT Puffer.",
  },
  "ref-9-asics-slash.jpg": {
    label: "Slash labels",
    description: "Labels separados por `/` flutuando. Inspiração: Asics × BEAMS.",
  },
  "ref-10-faine-blur.jpg": {
    label: "Blur hero + bestsellers",
    description: "Hero atmosférico com row de bestsellers. Inspiração: FAINE.",
  },
  "in-house": {
    label: "Classic editorial",
    description: "Layout padrão usado no cron diário (até a v1).",
  },
};

function PreviewCard({
  layout,
  workspaceId,
  productId,
}: {
  layout: LayoutMeta;
  workspaceId: string;
  productId: string | null;
}) {
  const [slot, setSlot] = useState<number>(layout.slots[0]);
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ slot: String(slot) });
    if (productId) params.set("product_id", productId);
    fetch(`/api/crm/email-templates/layouts/${layout.id}/preview?${params}`, {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d: PreviewResp) => setHtml(d.html ?? ""))
      .finally(() => setLoading(false));
  }, [layout.id, slot, workspaceId, productId]);

  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="p-3 border-b">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Badge variant={layout.mode === "dark" ? "default" : "outline"}>
            {layout.mode}
          </Badge>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {layout.id}
          </Badge>
        </div>
        <div className="font-medium text-sm truncate">{layout.pattern_name}</div>
      </div>
      <div
        className="bg-neutral-100 flex items-start justify-center"
        style={{ height: 380 }}
      >
        {loading ? (
          <div className="p-4 text-muted-foreground text-xs">Carregando preview...</div>
        ) : (
          <iframe
            srcDoc={html}
            className="w-full h-full border-0 bg-white"
            sandbox=""
            title={`Preview ${layout.id} slot ${slot}`}
            style={{ transform: "scale(0.65)", transformOrigin: "top center" }}
          />
        )}
      </div>
      <div className="p-3 border-t flex items-center gap-2">
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
            <Button size="sm" variant="outline" className="h-8 px-2 text-xs gap-1">
              <Maximize2 className="w-3 h-3" />
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
        <a
          href={`/crm/email-templates/compose/${layout.id}`}
          className="ml-auto inline-flex items-center justify-center gap-1 h-8 px-3 text-xs font-semibold rounded bg-foreground text-background hover:opacity-90"
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
      <Label className="text-xs text-muted-foreground">
        Produto pra simular ({value ? "real" : "fixture"})
      </Label>
      {value ? (
        <div className="flex items-center gap-2 border rounded p-2 max-w-sm">
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

export default function LayoutLibraryPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? "";
  const [layouts, setLayouts] = useState<LayoutMeta[]>([]);
  const [filter, setFilter] = useState<"all" | "light" | "dark">("all");
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null);

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

  // Group by reference_image so light/dark of same pattern stay together.
  const grouped = useMemo(() => {
    const out: Record<string, LayoutMeta[]> = {};
    for (const l of filtered) {
      (out[l.reference_image] ||= []).push(l);
    }
    // Stable category order — match the catalog of references 1..10 + classic.
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
    return order
      .filter((k) => out[k])
      .map((k) => ({ key: k, items: out[k] }));
  }, [filtered]);

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
          <h1 className="text-2xl font-bold">Catálogo de templates</h1>
          <p className="text-muted-foreground text-sm">
            {layouts.length} layouts disponíveis em {grouped.length} categorias. Selecione um
            produto pra ver os previews com peças reais do seu catálogo VNDA.
          </p>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Modo</Label>
            <Select value={filter} onValueChange={(v) => setFilter(v as "all" | "light" | "dark")}>
              <SelectTrigger className="w-32 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>
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

      {grouped.map(({ key, items }) => {
        const meta = CATEGORY_META[key] ?? { label: key, description: "" };
        return (
          <section key={key} className="space-y-3">
            <div className="border-l-4 border-foreground pl-3 py-1">
              <h2 className="text-lg font-semibold">{meta.label}</h2>
              <p className="text-xs text-muted-foreground">{meta.description}</p>
              <div className="text-[10px] font-mono text-muted-foreground mt-1">
                {items.length} variação{items.length === 1 ? "" : "ões"} · ref:{" "}
                {key === "in-house" ? "—" : key}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((layout) => (
                <PreviewCard
                  key={layout.id}
                  layout={layout}
                  workspaceId={workspaceId}
                  productId={previewProduct?.vnda_id ?? null}
                />
              ))}
            </div>
          </section>
        );
      })}

      {grouped.length === 0 && (
        <div className="border rounded p-8 text-center text-muted-foreground">
          Nenhum layout no filtro selecionado.
        </div>
      )}
    </div>
  );
}

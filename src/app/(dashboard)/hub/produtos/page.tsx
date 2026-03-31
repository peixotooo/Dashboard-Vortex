"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
  Loader2,
  Search,
  Trash2,
  Check,
  X,
  Package,
  ImageIcon,
  ChevronDown,
  ChevronRight,
  Star,
  Truck,
  Zap,
  Eye,
  ShoppingCart,
  Crown,
  TrendingUp,
  Tag,
  PackageOpen,
  Send,
  DollarSign,
  AlertTriangle,
  Link2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/lib/workspace-context";
import type { HubProduct, MLData, MLEnrichment, MLEnrichmentAttr } from "@/types/hub";

// -------------------------------------------------------------------
// Sync status badge
// -------------------------------------------------------------------
function SyncBadge({ status, eccId, mlItemId, eccSku }: { status: string; eccId?: number | null; mlItemId?: string | null; eccSku?: string | null }) {
  // Full chain: Eccosys → Hub → ML
  const isLinked = status === "synced" && !!eccId && !!mlItemId;
  const map: Record<string, { label: string; variant: string; desc: string }> = {
    draft: { label: "Rascunho", variant: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300", desc: "Produto importado, ainda nao publicado no ML" },
    ready: { label: "Pronto", variant: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300", desc: "Dados completos, pronto para publicar" },
    synced: { label: "Sincronizado", variant: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300", desc: "Publicado e ativo no Mercado Livre" },
    linked: { label: "Vinculado", variant: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300", desc: "Vinculado na cadeia completa: Eccosys \u2194 Hub \u2194 ML" },
    error: { label: "Erro", variant: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300", desc: "Falha na publicacao ou sincronizacao" },
  };
  const key = isLinked ? "linked" : status;
  const badge = map[key] || map.draft;
  const tooltip = isLinked && eccSku
    ? `${badge.desc}\nEccosys: ${eccSku}`
    : badge.desc;
  return (
    <span className="inline-flex items-center gap-1 group relative">
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.variant}`}>
        {badge.label}
      </span>
      <span className="text-[10px] text-muted-foreground cursor-help" title={tooltip}>?</span>
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  return source === "eccosys" ? (
    <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
      Eccosys
    </Badge>
  ) : (
    <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">
      ML
    </Badge>
  );
}

// -------------------------------------------------------------------
// ML Listing Type Badge
// -------------------------------------------------------------------
function ListingTypeBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; className: string; icon: boolean }> = {
    gold_special: {
      label: "Premium",
      className: "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-300",
      icon: true,
    },
    gold_pro: {
      label: "Classico",
      className: "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300",
      icon: true,
    },
    free: {
      label: "Gratis",
      className: "bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-400",
      icon: false,
    },
  };
  const badge = map[type] || { label: type, className: "bg-gray-100 text-gray-600 border-gray-300", icon: false };
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${badge.className}`}>
      {badge.icon && <Star className="h-2.5 w-2.5" />}
      {badge.label}
    </span>
  );
}

// -------------------------------------------------------------------
// Shipping Badge
// -------------------------------------------------------------------
function ShippingBadge({ mlData }: { mlData: MLData }) {
  if (mlData.logistic_type === "fulfillment") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-300 dark:bg-green-900/30 dark:text-green-300">
        <Zap className="h-2.5 w-2.5" />
        Full
      </span>
    );
  }
  if (mlData.free_shipping) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-50 text-green-600 border border-green-200 dark:bg-green-900/20 dark:text-green-400">
        <Truck className="h-2.5 w-2.5" />
        Frete Gratis
      </span>
    );
  }
  return null;
}

// -------------------------------------------------------------------
// Health Score (quality meter)
// -------------------------------------------------------------------
function HealthScore({ health }: { health: number | null }) {
  if (health == null) return null;
  const pct = Math.round(health * 100);
  const color =
    pct >= 80
      ? "bg-green-500"
      : pct >= 50
        ? "bg-yellow-500"
        : "bg-red-500";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex items-center gap-1 cursor-default">
          <TrendingUp className="h-2.5 w-2.5 text-muted-foreground" />
          <div className="w-10 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full ${color}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">{pct}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>Qualidade do anuncio: {pct}%</TooltipContent>
    </Tooltip>
  );
}

// -------------------------------------------------------------------
// ML Detail Chips Row
// -------------------------------------------------------------------
function MLDetailChips({ mlData }: { mlData: MLData }) {
  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      <ListingTypeBadge type={mlData.listing_type_id} />
      <ShippingBadge mlData={mlData} />

      {mlData.condition === "used" && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 border border-orange-200 dark:bg-orange-900/20 dark:text-orange-400">
          <Tag className="h-2.5 w-2.5" />
          Usado
        </span>
      )}

      {mlData.catalog_listing && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 border border-purple-200 dark:bg-purple-900/20 dark:text-purple-400">
          <Crown className="h-2.5 w-2.5" />
          Catalogo
        </span>
      )}

      {mlData.sold_quantity > 0 && (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
          <ShoppingCart className="h-2.5 w-2.5" />
          {mlData.sold_quantity} vendidos
        </span>
      )}

      {mlData.visits != null && mlData.visits > 0 && (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
          <Eye className="h-2.5 w-2.5" />
          {mlData.visits.toLocaleString("pt-BR")}
        </span>
      )}

      <HealthScore health={mlData.health} />
    </div>
  );
}

// -------------------------------------------------------------------
// Inline Stock Editor (for sob_demanda products)
// -------------------------------------------------------------------
function InlineStockEditor({
  productId,
  currentStock,
  workspaceId,
  onUpdated,
}: {
  productId: string;
  currentStock: number;
  workspaceId: string;
  onUpdated: () => void;
}) {
  const [value, setValue] = useState(String(currentStock));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValue(String(currentStock));
  }, [currentStock]);

  async function save() {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0 || num === currentStock) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/hub/products", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({ id: productId, estoque: num }),
      });
      if (res.ok) {
        setSaved(true);
        onUpdated();
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
        }}
        className="w-16 h-7 text-right text-sm font-medium rounded border border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {saved && <Check className="h-3 w-3 text-green-500" />}
    </div>
  );
}

// -------------------------------------------------------------------
// Inline Price Editor (preco + preco_promocional)
// -------------------------------------------------------------------
function InlinePriceEditor({
  productId,
  currentPreco,
  currentPrecoPromo,
  workspaceId,
  onUpdated,
}: {
  productId: string;
  currentPreco: number;
  currentPrecoPromo: number | null;
  workspaceId: string;
  onUpdated: () => void;
}) {
  const [value, setValue] = useState(currentPreco.toFixed(2));
  const [promoValue, setPromoValue] = useState(
    currentPrecoPromo != null ? currentPrecoPromo.toFixed(2) : ""
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValue(currentPreco.toFixed(2));
    setPromoValue(currentPrecoPromo != null ? currentPrecoPromo.toFixed(2) : "");
  }, [currentPreco, currentPrecoPromo]);

  async function savePreco() {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0 || num === currentPreco) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/hub/products", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({ id: productId, preco: num }),
      });
      if (res.ok) {
        setSaved(true);
        onUpdated();
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }

  async function savePromo() {
    const num = promoValue ? parseFloat(promoValue) : null;
    if (num !== null && (isNaN(num) || num < 0)) return;
    if (num === currentPrecoPromo) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/hub/products", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({ id: productId, preco_promocional: num }),
      });
      if (res.ok) {
        setSaved(true);
        onUpdated();
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground w-4">R$</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={savePreco}
          onKeyDown={(e) => { if (e.key === "Enter") savePreco(); }}
          className="w-20 h-7 text-right text-sm font-medium rounded border border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        {saved && <Check className="h-3 w-3 text-green-500" />}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-green-600 w-4">P</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={promoValue}
          onChange={(e) => setPromoValue(e.target.value)}
          onBlur={savePromo}
          onKeyDown={(e) => { if (e.key === "Enter") savePromo(); }}
          placeholder="—"
          className="w-20 h-6 text-right text-xs rounded border border-dashed border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring text-green-600"
        />
      </div>
    </div>
  );
}

// -------------------------------------------------------------------
// Sob Demanda Toggle
// -------------------------------------------------------------------
function SobDemandaToggle({
  productId,
  sobDemanda,
  workspaceId,
  onUpdated,
}: {
  productId: string;
  sobDemanda: boolean;
  workspaceId: string;
  onUpdated: () => void;
}) {
  const [toggling, setToggling] = useState(false);

  async function toggle() {
    setToggling(true);
    try {
      await fetch("/api/hub/products", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({ id: productId, sob_demanda: !sobDemanda }),
      });
      onUpdated();
    } finally {
      setToggling(false);
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          disabled={toggling}
          className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded border transition-colors ${
            sobDemanda
              ? "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300"
              : "bg-transparent text-muted-foreground border-dashed border-muted-foreground/30 hover:border-muted-foreground/60"
          }`}
        >
          {toggling ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : (
            <PackageOpen className="h-2.5 w-2.5" />
          )}
          {sobDemanda ? "Sob Demanda" : "S.D."}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {sobDemanda
          ? "Estoque virtual controlado pelo Hub. Clique para desativar."
          : "Clique para ativar estoque virtual (sob demanda)"}
      </TooltipContent>
    </Tooltip>
  );
}

// -------------------------------------------------------------------
// Import Family Modal (Eccosys parent + children + ML enrichment)
// -------------------------------------------------------------------

interface FamilyPreview {
  parent: {
    ecc_id: number;
    sku: string;
    nome: string;
    preco: number;
    foto: string | null;
    estoque: number;
    already_in_hub: boolean;
    atributos?: Record<string, string>;
  };
  children: Array<{
    ecc_id: number;
    sku: string;
    nome: string;
    preco: number;
    estoque: number;
    atributos: Record<string, string>;
    already_in_hub: boolean;
  }>;
  enrichment: MLEnrichment;
  predictions: Array<{
    category_id: string;
    name: string;
    path: string;
    probability: string;
  }>;
  warnings: Array<{ type: string; message: string; attribute_id?: string }>;
  cross_ref: { ml_item_id: string; title: string } | null;
}

function ImportFamilyModal({
  open,
  onClose,
  workspaceId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"search" | "preview" | "result">("search");
  const [parentSku, setParentSku] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<FamilyPreview | null>(null);
  const [enrichment, setEnrichment] = useState<MLEnrichment | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    imported: number;
    errors: number;
  } | null>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep("search");
      setParentSku("");
      setPreview(null);
      setEnrichment(null);
      setError("");
      setResult(null);
    }
  }, [open]);

  async function handleSearch() {
    if (!parentSku.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/sync/import-family?parent_sku=${encodeURIComponent(parentSku.trim())}`,
        { headers: { "x-workspace-id": workspaceId } }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao buscar familia");
        return;
      }
      setPreview(data);
      setEnrichment(data.enrichment);
      setStep("preview");
    } catch {
      setError("Erro de conexao");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!preview || !enrichment) return;
    setImporting(true);
    try {
      const eccIds = [
        preview.parent.ecc_id,
        ...preview.children.map((c) => c.ecc_id),
      ];
      const res = await fetch("/api/sync/import-family", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          parent_sku: preview.parent.sku,
          ecc_ids: eccIds,
          enrichment,
        }),
      });
      const data = await res.json();
      setResult({ imported: data.imported || 0, errors: data.errors || 0 });
      setStep("result");
    } finally {
      setImporting(false);
    }
  }

  const [reEnriching, setReEnriching] = useState(false);

  async function handleCategoryChange(categoryId: string) {
    if (!preview || !enrichment) return;

    // Merge all Eccosys attributes (parent + children)
    const allEccAttrs: Record<string, string> = {
      ...(preview.parent.atributos || {}),
    };
    for (const child of preview.children) {
      for (const [k, v] of Object.entries(child.atributos || {})) {
        if (!allEccAttrs[k]) allEccAttrs[k] = v;
      }
    }
    const sampleVariationAttrs = preview.children[0]?.atributos || {};

    setReEnriching(true);
    try {
      const res = await fetch("/api/sync/import-family", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          category_id: categoryId,
          all_ecc_attrs: allEccAttrs,
          sample_variation_attrs: sampleVariationAttrs,
        }),
      });
      const data = await res.json();
      if (res.ok && data.enrichment) {
        setEnrichment(data.enrichment);
        setPreview({
          ...preview,
          warnings: data.warnings || [],
          cross_ref: data.cross_ref,
        });
      }
    } catch {
      /* re-enrich failed, keep current enrichment */
    } finally {
      setReEnriching(false);
    }
  }

  function updateEnrichmentAttr(attrId: string, value: string) {
    if (!enrichment) return;
    setEnrichment({
      ...enrichment,
      attributes: enrichment.attributes.map((a) =>
        a.id === attrId ? { ...a, value_name: value, source: "manual" as const } : a
      ),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Importar Familia de Produtos</DialogTitle>
          <DialogDescription>
            Insira o codigo do produto pai para importar toda a familia com
            enriquecimento ML automatico.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Search */}
        {step === "search" && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Codigo do produto pai (ex: BLK-001)"
                value={parentSku}
                onChange={(e) => setParentSku(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch();
                }}
                disabled={loading}
                autoFocus
              />
              <Button onClick={handleSearch} disabled={loading || !parentSku.trim()}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                Buscar
              </Button>
            </div>
            {error && (
              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Preview */}
        {step === "preview" && preview && enrichment && (
          <div className="flex-1 overflow-auto space-y-4">
            {/* Parent card */}
            <div className="flex items-center gap-4 p-3 border rounded-lg bg-muted/30">
              {preview.parent.foto && (
                <Image
                  src={preview.parent.foto}
                  alt={preview.parent.nome}
                  width={56}
                  height={56}
                  className="rounded object-cover"
                  unoptimized
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{preview.parent.nome}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  {preview.parent.sku}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium">
                  {preview.parent.preco?.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  Estoque: {preview.parent.estoque}
                </p>
              </div>
              {preview.parent.already_in_hub && (
                <Badge variant="outline" className="text-green-600 border-green-300 text-xs">
                  Ja no Hub
                </Badge>
              )}
            </div>

            {/* Children table */}
            {preview.children.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">
                  Variacoes ({preview.children.length})
                </h4>
                <div className="border rounded-lg overflow-auto max-h-[200px]">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="p-2 text-left text-xs font-medium">SKU</th>
                        <th className="p-2 text-left text-xs font-medium">Atributos</th>
                        <th className="p-2 text-right text-xs font-medium">Preco</th>
                        <th className="p-2 text-center text-xs font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.children.map((c) => (
                        <tr key={c.ecc_id} className="border-t">
                          <td className="p-2 font-mono text-xs">{c.sku}</td>
                          <td className="p-2 text-xs">
                            {Object.entries(c.atributos || {})
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(", ") || "—"}
                          </td>
                          <td className="p-2 text-right text-xs">
                            {c.preco?.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })}
                          </td>
                          <td className="p-2 text-center">
                            {c.already_in_hub ? (
                              <Badge
                                variant="outline"
                                className="text-green-600 border-green-300 text-[10px]"
                              >
                                No Hub
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">
                                Novo
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ML Enrichment Section */}
            <div className="border rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-yellow-500" />
                  Enriquecimento ML
                </h4>
                {preview.cross_ref && (
                  <span className="text-[11px] text-muted-foreground">
                    Modelo: {preview.cross_ref.ml_item_id} —{" "}
                    {preview.cross_ref.title?.substring(0, 40)}
                  </span>
                )}
              </div>

              {/* Category */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Categoria ML
                  </label>
                  {preview.predictions.length > 0 ? (
                    <Select
                      value={enrichment.category_id}
                      onValueChange={handleCategoryChange}
                      disabled={reEnriching}
                    >
                      <SelectTrigger className="mt-1">
                        {reEnriching ? (
                          <span className="flex items-center gap-1.5 text-xs">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Carregando atributos...
                          </span>
                        ) : (
                          <SelectValue placeholder="Selecione..." />
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        {preview.predictions.map((p) => (
                          <SelectItem key={p.category_id} value={p.category_id}>
                            <span className="text-xs">
                              {p.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={enrichment.category_id}
                      onChange={(e) =>
                        setEnrichment({
                          ...enrichment,
                          category_id: e.target.value,
                        })
                      }
                      placeholder="ID da categoria ML"
                      className="mt-1"
                    />
                  )}
                  {enrichment.category_path && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      {enrichment.category_path}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Tipo de Anuncio
                  </label>
                  <Select
                    value={enrichment.listing_type_id}
                    onValueChange={(val) =>
                      setEnrichment({ ...enrichment, listing_type_id: val })
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gold_special">Premium</SelectItem>
                      <SelectItem value="gold_pro">Classico</SelectItem>
                      <SelectItem value="free">Gratis</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Required Attributes */}
              {enrichment.attributes.filter((a) => a.required).length > 0 && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Atributos Obrigatorios
                  </label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {enrichment.attributes
                      .filter((a) => a.required)
                      .map((attr) => (
                        <div key={attr.id} className="flex items-center gap-2">
                          <label className="text-xs min-w-[80px] truncate" title={attr.name}>
                            {attr.name}
                          </label>
                          <Input
                            value={attr.value_name}
                            onChange={(e) =>
                              updateEnrichmentAttr(attr.id, e.target.value)
                            }
                            placeholder={attr.name}
                            className={`h-7 text-xs ${
                              !attr.value_name
                                ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20"
                                : ""
                            }`}
                          />
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Variation Mapping */}
              {Object.keys(enrichment.variation_attr_map).length > 0 && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Mapeamento de Variacoes
                  </label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {Object.entries(enrichment.variation_attr_map).map(
                      ([eccKey, mlId]) => (
                        <Badge
                          key={eccKey}
                          variant="outline"
                          className="text-xs font-mono"
                        >
                          {eccKey} → {mlId}
                        </Badge>
                      )
                    )}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {preview.warnings.length > 0 && (
                <div className="space-y-1">
                  {preview.warnings.map((w, i) => (
                    <p
                      key={i}
                      className={`text-xs px-2 py-1 rounded ${
                        w.type === "missing_required_attr"
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                          : "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                      }`}
                    >
                      {w.message}
                    </p>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm text-muted-foreground">
                {1 + preview.children.length} produto(s) para importar
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep("search");
                    setPreview(null);
                  }}
                >
                  Voltar
                </Button>
                <Button onClick={handleImport} disabled={importing}>
                  {importing ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <ArrowDownToLine className="h-4 w-4 mr-2" />
                  )}
                  Importar Familia
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Result */}
        {step === "result" && result && (
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <div className="text-center space-y-1">
              <p className="font-medium">Importacao concluida</p>
              <p className="text-sm text-muted-foreground">
                {result.imported} importado(s)
                {result.errors > 0 && `, ${result.errors} erro(s)`}
              </p>
            </div>
            <Button
              onClick={() => {
                onDone();
                onClose();
              }}
            >
              Fechar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------
// Pull Eccosys Modal
// -------------------------------------------------------------------
interface EccProduct {
  id: number;
  sku: string;
  nome: string;
  preco: number;
  foto: string | null;
  already_in_hub: boolean;
}

function PullEccosysModal({
  open,
  onClose,
  workspaceId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  onDone: () => void;
}) {
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<EccProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const fetchProducts = useCallback(
    async (p = 0, s = search) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(p) });
        if (s) params.set("search", s);
        const res = await fetch(`/api/sync/pull-eccosys?${params}`, {
          headers: { "x-workspace-id": workspaceId },
        });
        if (res.ok) {
          const data = await res.json();
          setProducts(p === 0 ? data.products : [...products, ...data.products]);
          setHasMore(data.hasMore);
          setPage(p);
        }
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId, search]
  );

  useEffect(() => {
    if (open) {
      fetchProducts(0);
      setSelected(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleImport() {
    setImporting(true);
    try {
      const res = await fetch("/api/sync/pull-eccosys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (res.ok) {
        onDone();
        onClose();
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Puxar Produtos do Eccosys</DialogTitle>
          <DialogDescription>
            Busque e selecione os produtos que deseja importar para o Hub.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") fetchProducts(0, search);
              }}
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => fetchProducts(0, search)}
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto border rounded-lg">
          {loading && products.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Package className="h-8 w-8 mb-2" />
              <p className="text-sm">Nenhum produto encontrado</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="p-3 w-10"></th>
                  <th className="p-3 text-left font-medium">SKU</th>
                  <th className="p-3 text-left font-medium">Nome</th>
                  <th className="p-3 text-right font-medium">Preco</th>
                  <th className="p-3 text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-t hover:bg-muted/30 cursor-pointer ${
                      selected.has(p.id) ? "bg-primary/5" : ""
                    }`}
                    onClick={() => !p.already_in_hub && toggleSelect(p.id)}
                  >
                    <td className="p-3 text-center">
                      {p.already_in_hub ? (
                        <Check className="h-4 w-4 text-green-500 mx-auto" />
                      ) : (
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggleSelect(p.id)}
                          className="rounded"
                        />
                      )}
                    </td>
                    <td className="p-3 font-mono text-xs">{p.sku}</td>
                    <td className="p-3 truncate max-w-[250px]">{p.nome}</td>
                    <td className="p-3 text-right">
                      {p.preco?.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </td>
                    <td className="p-3 text-center">
                      {p.already_in_hub ? (
                        <Badge variant="outline" className="text-xs text-green-600">
                          No Hub
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Disponivel
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchProducts(page + 1)}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Carregar mais
          </Button>
        )}

        <div className="flex items-center gap-3 w-full justify-between border-t pt-4">
            <span className="text-sm text-muted-foreground">
              {selected.size} selecionado(s)
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                onClick={handleImport}
                disabled={selected.size === 0 || importing}
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <ArrowDownToLine className="h-4 w-4 mr-2" />
                )}
                Importar {selected.size > 0 ? `(${selected.size})` : ""}
              </Button>
            </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------
// Push to ML Modal (with category prediction)
// -------------------------------------------------------------------
interface CategoryPrediction {
  category_id: string;
  name: string;
  probability: string;
  path: string;
}

function PushMLModal({
  open,
  onClose,
  workspaceId,
  selectedSkus,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  selectedSkus: string[];
  onDone: () => void;
}) {
  const [predictions, setPredictions] = useState<CategoryPrediction[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [listingType, setListingType] = useState<"gold_special" | "gold_pro">("gold_special");
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<{
    published: number;
    errors: number;
  } | null>(null);

  // Reset when modal opens
  useEffect(() => {
    if (!open || selectedSkus.length === 0) return;
    setPredictions([]);
    setSelectedCategory("");
    setListingType("gold_special");
    setResult(null);
  }, [open, selectedSkus]);

  async function predictCategory(title: string) {
    if (!title) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/sync/predict-category?title=${encodeURIComponent(title)}`,
        { headers: { "x-workspace-id": workspaceId } }
      );
      if (res.ok) {
        const data = await res.json();
        setPredictions(data.predictions || []);
        if (data.predictions?.length > 0) {
          setSelectedCategory(data.predictions[0].category_id);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function handlePublish() {
    if (!selectedCategory) return;
    setPublishing(true);
    try {
      const res = await fetch("/api/sync/push-ml", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          skus: selectedSkus,
          category_id: selectedCategory,
          listing_type_id: listingType,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setResult({ published: data.published, errors: data.errors });
        onDone();
      }
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Publicar no Mercado Livre</DialogTitle>
          <DialogDescription>
            {selectedSkus.length} produto(s) selecionado(s) para publicacao.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-500" />
              <span className="font-medium">
                {result.published} publicado(s)
              </span>
            </div>
            {result.errors > 0 && (
              <div className="flex items-center gap-2">
                <X className="h-5 w-5 text-destructive" />
                <span className="text-sm text-destructive">
                  {result.errors} erro(s) — veja a coluna Status na tabela
                </span>
              </div>
            )}
            <Button className="w-full" onClick={onClose}>
              Fechar
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Category search */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Categoria ML
              </label>
              <div className="flex gap-2">
                <Input
                  placeholder="Buscar categoria por titulo do produto..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      predictCategory((e.target as HTMLInputElement).value);
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="icon"
                  disabled={loading}
                  onClick={(e) => {
                    const input = (e.target as HTMLElement)
                      .closest(".space-y-2")
                      ?.querySelector("input");
                    if (input) predictCategory(input.value);
                  }}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {predictions.length > 0 && (
                <div className="space-y-1 mt-2">
                  {predictions.map((pred) => (
                    <button
                      key={pred.category_id}
                      type="button"
                      onClick={() => setSelectedCategory(pred.category_id)}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm border transition-colors ${
                        selectedCategory === pred.category_id
                          ? "border-primary bg-primary/5"
                          : "border-transparent hover:bg-muted"
                      }`}
                    >
                      <div className="font-medium">{pred.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {pred.path}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Manual category ID input */}
              <div className="flex gap-2 items-center mt-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  ou ID direto:
                </span>
                <Input
                  placeholder="MLB31447"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            {/* Listing type selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipo de anuncio</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setListingType("gold_special")}
                  className={`flex-1 px-3 py-2 rounded-md text-sm border transition-colors ${
                    listingType === "gold_special"
                      ? "border-primary bg-primary/5 font-medium"
                      : "border-muted hover:bg-muted"
                  }`}
                >
                  <div>Classico</div>
                  <div className="text-xs text-muted-foreground">Comissao menor</div>
                </button>
                <button
                  type="button"
                  onClick={() => setListingType("gold_pro")}
                  className={`flex-1 px-3 py-2 rounded-md text-sm border transition-colors ${
                    listingType === "gold_pro"
                      ? "border-primary bg-primary/5 font-medium"
                      : "border-muted hover:bg-muted"
                  }`}
                >
                  <div>Premium</div>
                  <div className="text-xs text-muted-foreground">Mais visibilidade</div>
                </button>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                onClick={handlePublish}
                disabled={!selectedCategory || publishing}
              >
                {publishing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <ArrowUpFromLine className="h-4 w-4 mr-2" />
                )}
                Publicar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------
// Pull ML Modal
// -------------------------------------------------------------------
interface MLListItem {
  ml_item_id: string;
  title: string;
  price: number;
  original_price: number | null;
  quantity: number;
  sold_quantity: number;
  status: string;
  permalink: string;
  sku: string | null;
  skus: string[];
  thumbnail: string | null;
  photos_count: number;
  variations_count: number;
  already_in_hub: boolean;
  listing_type_id: string | null;
  condition: string | null;
  free_shipping: boolean;
  logistic_type: string | null;
  health: number | null;
}

// -------------------------------------------------------------------
// Link Eccosys Modal — links ML products to Eccosys parent
// -------------------------------------------------------------------

interface LinkPreview {
  ecc_parent: { id: number; sku: string; nome: string; estoque: number };
  ecc_children: Array<{
    id: number;
    sku: string;
    nome: string;
    estoque: number;
    atributos: Record<string, string>;
  }>;
  ml_parent: { id: string; sku: string; nome: string | null } | null;
  ml_children: Array<{
    id: string;
    sku: string;
    nome: string | null;
    ml_variation_id: number;
    atributos: Record<string, string>;
  }>;
  matches: Array<{
    ml_id: string;
    ml_sku: string;
    ecc_id: number;
    ecc_sku: string;
    matched_by: string;
  }>;
  unmatched_ml: string[];
  unmatched_ecc: string[];
}

function LinkEccosysModal({
  open,
  onClose,
  workspaceId,
  mlItemId,
  productName,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  mlItemId: string;
  productName: string;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"search" | "preview" | "result">("search");
  const [eccSku, setEccSku] = useState("");
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ linked: number } | null>(null);

  useEffect(() => {
    if (open) {
      setStep("search");
      setEccSku("");
      setPreview(null);
      setError("");
      setResult(null);
    }
  }, [open]);

  async function handleSearch() {
    if (!eccSku.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/hub/link-eccosys?ecc_parent_sku=${encodeURIComponent(eccSku.trim())}&ml_item_id=${encodeURIComponent(mlItemId)}`,
        { headers: { "x-workspace-id": workspaceId } }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao buscar produto");
        return;
      }
      setPreview(data);
      setStep("preview");
    } catch {
      setError("Erro de conexao");
    } finally {
      setLoading(false);
    }
  }

  async function handleLink() {
    if (!preview) return;
    setLinking(true);
    try {
      const res = await fetch("/api/hub/link-eccosys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          ml_item_id: mlItemId,
          ecc_parent_sku: eccSku.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao vincular");
        return;
      }
      setResult({ linked: data.linked });
      setStep("result");
      onDone();
    } catch {
      setError("Erro de conexao");
    } finally {
      setLinking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Vincular ao Eccosys</DialogTitle>
          <DialogDescription>
            Vincule o anuncio &quot;{productName}&quot; ({mlItemId}) a um produto do Eccosys.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Search */}
        {step === "search" && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Codigo do produto pai no Eccosys"
                value={eccSku}
                onChange={(e) => setEccSku(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch();
                }}
                disabled={loading}
                autoFocus
              />
              <Button onClick={handleSearch} disabled={loading || !eccSku.trim()}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                Buscar
              </Button>
            </div>
            {error && (
              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Preview */}
        {step === "preview" && preview && (
          <div className="flex-1 overflow-auto space-y-4">
            {/* Parent match */}
            <div className="p-3 border rounded-lg bg-muted/30">
              <p className="text-xs font-medium text-muted-foreground mb-1">Produto pai Eccosys</p>
              <p className="font-medium">{preview.ecc_parent.nome}</p>
              <p className="text-xs text-muted-foreground font-mono">{preview.ecc_parent.sku}</p>
            </div>

            {/* Matches table */}
            {preview.matches.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">
                  Variacoes encontradas: {preview.matches.length}
                </p>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">ML (atual)</th>
                        <th className="text-center p-2 font-medium w-8"></th>
                        <th className="text-left p-2 font-medium">Eccosys</th>
                        <th className="text-right p-2 font-medium">Estoque</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.matches.map((m) => {
                        const eccChild = preview.ecc_children.find(
                          (c) => c.sku === m.ecc_sku
                        );
                        const mlChild = preview.ml_children.find(
                          (c) => c.id === m.ml_id
                        );
                        return (
                          <tr key={m.ml_id} className="border-t">
                            <td className="p-2">
                              <span className="font-mono text-xs">{mlChild?.sku || m.ml_sku}</span>
                            </td>
                            <td className="p-2 text-center">
                              <Check className="h-4 w-4 text-green-600 inline" />
                            </td>
                            <td className="p-2">
                              <span className="font-mono text-xs">{m.ecc_sku}</span>
                              <span className="text-xs text-muted-foreground ml-2">
                                ({m.matched_by})
                              </span>
                            </td>
                            <td className="p-2 text-right font-mono text-xs">
                              {eccChild?.estoque ?? "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Simple product (no variations) */}
            {preview.matches.length === 0 && preview.ml_children.length === 0 && preview.ecc_children.length === 0 && (
              <div className="p-3 border rounded-lg">
                <p className="text-sm">
                  Produto simples (sem variacoes). Sera vinculado diretamente.
                </p>
              </div>
            )}

            {/* Unmatched warnings */}
            {preview.unmatched_ml.length > 0 && (
              <div className="text-sm text-amber-700 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  {preview.unmatched_ml.length} variacao(oes) do ML sem correspondencia no Eccosys: {preview.unmatched_ml.join(", ")}
                </span>
              </div>
            )}

            {preview.unmatched_ecc.length > 0 && (
              <div className="text-sm text-amber-700 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  {preview.unmatched_ecc.length} variacao(oes) do Eccosys sem correspondencia no ML: {preview.unmatched_ecc.join(", ")}
                </span>
              </div>
            )}

            {error && (
              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded">
                {error}
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => { setStep("search"); setError(""); }}>
                Voltar
              </Button>
              <Button
                onClick={handleLink}
                disabled={linking || (preview.matches.length === 0 && preview.ecc_children.length > 0)}
              >
                {linking ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Link2 className="h-4 w-4 mr-2" />
                )}
                Vincular
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Result */}
        {step === "result" && result && (
          <div className="space-y-4 text-center py-8">
            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full mx-auto flex items-center justify-center">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="font-medium text-lg">{result.linked} produto(s) vinculado(s)</p>
              <p className="text-sm text-muted-foreground mt-1">
                O estoque sera sincronizado automaticamente a cada hora.
              </p>
            </div>
            <Button onClick={onClose}>Fechar</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PullMLModal({
  open,
  onClose,
  workspaceId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  onDone: () => void;
}) {
  const [items, setItems] = useState<MLListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    linked: number;
    errors: number;
  } | null>(null);

  const fetchItems = useCallback(
    async (off = 0) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/sync/pull-ml?status=active&offset=${off}`,
          { headers: { "x-workspace-id": workspaceId } }
        );
        if (res.ok) {
          const data = await res.json();
          setItems(off === 0 ? data.items : [...items, ...data.items]);
          setTotal(data.total);
          setHasMore(data.hasMore);
          setOffset(off);
        }
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId]
  );

  useEffect(() => {
    if (open) {
      fetchItems(0);
      setSelected(new Set());
      setResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleImport() {
    setImporting(true);
    try {
      const res = await fetch("/api/sync/pull-ml", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({ item_ids: Array.from(selected) }),
      });
      if (res.ok) {
        const data = await res.json();
        setResult({
          imported: data.imported,
          linked: data.linked,
          errors: data.errors?.length || 0,
        });
        onDone();
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Puxar Anuncios do Mercado Livre</DialogTitle>
          <DialogDescription>
            Selecione os anuncios que deseja importar para o Hub.
            {total > 0 && ` ${total} anuncio(s) ativo(s) encontrado(s).`}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-500" />
              <span className="font-medium">
                {result.imported} importado(s)
              </span>
            </div>
            {result.linked > 0 && (
              <div className="flex items-center gap-2">
                <ArrowDownToLine className="h-5 w-5 text-blue-500" />
                <span className="text-sm text-blue-600">
                  {result.linked} vinculado(s) por SKU
                </span>
              </div>
            )}
            {result.errors > 0 && (
              <div className="flex items-center gap-2">
                <X className="h-5 w-5 text-destructive" />
                <span className="text-sm text-destructive">
                  {result.errors} erro(s)
                </span>
              </div>
            )}
            <Button className="w-full" onClick={onClose}>
              Fechar
            </Button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-auto border rounded-lg">
              {loading && items.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Package className="h-8 w-8 mb-2" />
                  <p className="text-sm">Nenhum anuncio encontrado</p>
                  <p className="text-xs mt-1">
                    Verifique se o Mercado Livre esta conectado
                  </p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="p-3 w-10"></th>
                      <th className="p-3 w-12"></th>
                      <th className="p-3 text-left font-medium">SKU / ID</th>
                      <th className="p-3 text-left font-medium">Anuncio</th>
                      <th className="p-3 text-right font-medium">Preco</th>
                      <th className="p-3 text-center font-medium">Fotos</th>
                      <th className="p-3 text-center font-medium">Var.</th>
                      <th className="p-3 text-center font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr
                        key={item.ml_item_id}
                        className={`border-t hover:bg-muted/30 cursor-pointer ${
                          selected.has(item.ml_item_id) ? "bg-primary/5" : ""
                        }`}
                        onClick={() =>
                          !item.already_in_hub && toggleSelect(item.ml_item_id)
                        }
                      >
                        <td className="p-3 text-center">
                          {item.already_in_hub ? (
                            <Check className="h-4 w-4 text-green-500 mx-auto" />
                          ) : (
                            <input
                              type="checkbox"
                              checked={selected.has(item.ml_item_id)}
                              onChange={() => toggleSelect(item.ml_item_id)}
                              className="rounded"
                            />
                          )}
                        </td>
                        <td className="p-3">
                          {item.thumbnail ? (
                            <img
                              src={item.thumbnail}
                              alt=""
                              className="w-10 h-10 rounded object-cover bg-muted"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                              <Package className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-col gap-0.5">
                            {item.skus.length > 0 ? (
                              <span className="font-mono text-xs font-semibold">
                                {item.skus[0]}
                                {item.skus.length > 1 && (
                                  <span className="text-muted-foreground font-normal">
                                    {" "}+{item.skus.length - 1}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="font-mono text-xs text-muted-foreground italic">
                                sem SKU
                              </span>
                            )}
                            <a
                              href={item.permalink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline inline-flex items-center gap-1 text-[11px]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {item.ml_item_id}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </td>
                        <td className="p-3 max-w-[250px]">
                          <div className="truncate">{item.title}</div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {item.listing_type_id && (
                              <ListingTypeBadge type={item.listing_type_id} />
                            )}
                            {item.logistic_type === "fulfillment" && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-green-700 dark:text-green-400">
                                <Zap className="h-2.5 w-2.5" />
                                Full
                              </span>
                            )}
                            {item.free_shipping && item.logistic_type !== "fulfillment" && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600 dark:text-green-400">
                                <Truck className="h-2.5 w-2.5" />
                                Frete Gratis
                              </span>
                            )}
                            {item.sold_quantity > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                {item.sold_quantity} vendidos
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-right">
                          {item.original_price != null &&
                           item.original_price > item.price && (
                            <div className="text-[10px] text-muted-foreground line-through">
                              {item.original_price.toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                              })}
                            </div>
                          )}
                          <div>
                            {item.price?.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })}
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          {item.photos_count > 0 ? (
                            <Badge variant="outline" className="text-xs">
                              {item.photos_count}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {item.variations_count > 0 ? (
                            <Badge variant="outline" className="text-xs">
                              {item.variations_count}
                            </Badge>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {item.already_in_hub ? (
                            <Badge
                              variant="outline"
                              className="text-xs text-green-600 border-green-300"
                            >
                              No Hub
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">
                              Disponivel
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {hasMore && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchItems(offset + 50)}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Carregar mais
              </Button>
            )}

            <div className="flex items-center gap-3 w-full justify-between border-t pt-4">
              <span className="text-sm text-muted-foreground">
                {selected.size} selecionado(s)
              </span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={selected.size === 0 || importing}
                >
                  {importing ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <ArrowDownToLine className="h-4 w-4 mr-2" />
                  )}
                  Importar {selected.size > 0 ? `(${selected.size})` : ""}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------
// Group products: parent + children
// -------------------------------------------------------------------
interface ProductGroup {
  parent: HubProduct;
  children: HubProduct[];
}

function groupProducts(products: HubProduct[]): ProductGroup[] {
  // Two grouping strategies:
  // 1. ML products: group by ml_item_id (parent = no ml_variation_id, children = with ml_variation_id)
  // 2. Eccosys products: group by ecc_pai_sku (children reference parent SKU)
  // This naturally separates multi-linked products (same Eccosys → multiple ML items)

  const mlGroups = new Map<string, { parent: HubProduct | null; children: HubProduct[] }>();
  const eccChildrenMap = new Map<string, HubProduct[]>();
  const usedAsChild = new Set<string>();

  // First pass: group ML products by ml_item_id
  for (const p of products) {
    if (p.ml_item_id && p.ml_variation_id) {
      // ML child
      const group = mlGroups.get(p.ml_item_id) || { parent: null, children: [] };
      group.children.push(p);
      mlGroups.set(p.ml_item_id, group);
      usedAsChild.add(p.sku);
    } else if (p.ml_item_id && !p.ml_variation_id) {
      // ML parent
      const group = mlGroups.get(p.ml_item_id) || { parent: null, children: [] };
      group.parent = p;
      mlGroups.set(p.ml_item_id, group);
    } else if (p.ecc_pai_sku && !p.ml_item_id) {
      // Pure Eccosys child
      const arr = eccChildrenMap.get(p.ecc_pai_sku) || [];
      arr.push(p);
      eccChildrenMap.set(p.ecc_pai_sku, arr);
      usedAsChild.add(p.sku);
    }
  }

  const groups: ProductGroup[] = [];
  const processed = new Set<string>();

  // Build ML groups
  for (const [, group] of mlGroups) {
    if (group.parent) {
      groups.push({ parent: group.parent, children: group.children });
      processed.add(group.parent.sku);
      for (const c of group.children) processed.add(c.sku);
    }
  }

  // Build Eccosys groups + ungrouped products
  for (const p of products) {
    if (processed.has(p.sku)) continue;
    if (usedAsChild.has(p.sku)) continue;

    const children = eccChildrenMap.get(p.sku) || [];
    groups.push({ parent: p, children });
    processed.add(p.sku);
    for (const c of children) processed.add(c.sku);
  }

  // Orphans
  for (const p of products) {
    if (!processed.has(p.sku)) {
      groups.push({ parent: p, children: [] });
    }
  }

  return groups;
}

// -------------------------------------------------------------------
// Bulk Price Sheet (sidebar)
// -------------------------------------------------------------------
type BulkOp = "set" | "increase_pct" | "decrease_pct" | "increase_fixed" | "decrease_fixed";

const BULK_OP_LABELS: Record<BulkOp, string> = {
  set: "Definir valor fixo",
  increase_pct: "Aumentar %",
  decrease_pct: "Diminuir %",
  increase_fixed: "Aumentar R$",
  decrease_fixed: "Diminuir R$",
};

function computePreview(current: number, op: BulkOp, val: number): number {
  switch (op) {
    case "set": return val;
    case "increase_pct": return Math.round(current * (1 + val / 100) * 100) / 100;
    case "decrease_pct": return Math.round(current * (1 - val / 100) * 100) / 100;
    case "increase_fixed": return Math.round((current + val) * 100) / 100;
    case "decrease_fixed": return Math.round(Math.max(0, current - val) * 100) / 100;
  }
}

function BulkPriceSheet({
  open,
  onOpenChange,
  workspaceId,
  selectedIds,
  products,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string;
  selectedIds: Set<string>;
  products: HubProduct[];
  onDone: () => void;
}) {
  const [field, setField] = useState<"preco" | "preco_promocional">("preco");
  const [operation, setOperation] = useState<BulkOp>("increase_pct");
  const [value, setValue] = useState("");
  const [pushToMl, setPushToMl] = useState(true);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ updated: number; ml_synced: number; errors: Array<{ sku: string; error: string }> } | null>(null);

  const numValue = parseFloat(value) || 0;

  // Get selected products for preview
  const selectedProducts = products.filter((p) => selectedIds.has(p.id));
  const previewItems = selectedProducts.slice(0, 10).map((p) => {
    const current = field === "preco"
      ? (p.preco ?? p.ml_preco ?? 0)
      : (p.preco_promocional ?? p.preco ?? 0);
    const newPrice = numValue > 0 ? computePreview(current, operation, numValue) : current;
    return { sku: p.sku, current, newPrice, hasML: !!p.ml_item_id };
  });

  async function handleApply() {
    if (numValue <= 0) return;
    setApplying(true);
    setResult(null);
    try {
      const res = await fetch("/api/hub/products/bulk-price", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          ids: Array.from(selectedIds),
          operation,
          value: numValue,
          field,
          push_to_ml: pushToMl,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setResult(data);
        onDone();
      } else {
        const data = await res.json().catch(() => ({}));
        setResult({ updated: 0, ml_synced: 0, errors: [{ sku: "-", error: data.error || "Erro desconhecido" }] });
      }
    } catch {
      setResult({ updated: 0, ml_synced: 0, errors: [{ sku: "-", error: "Erro de conexao" }] });
    } finally {
      setApplying(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Alterar Precos em Massa
          </SheetTitle>
          <SheetDescription>
            {selectedIds.size} produto(s) selecionado(s)
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 mt-6">
          {/* Field */}
          <div className="space-y-2">
            <Label>Campo</Label>
            <Select value={field} onValueChange={(v) => setField(v as "preco" | "preco_promocional")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="preco">Preco (R$)</SelectItem>
                <SelectItem value="preco_promocional">Preco Promocional</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Operation */}
          <div className="space-y-2">
            <Label>Operacao</Label>
            <Select value={operation} onValueChange={(v) => setOperation(v as BulkOp)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(BULK_OP_LABELS) as [BulkOp, string][]).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Value */}
          <div className="space-y-2">
            <Label>
              Valor {operation.includes("pct") ? "(%)" : "(R$)"}
            </Label>
            <Input
              type="number"
              step={operation.includes("pct") ? "1" : "0.01"}
              min="0"
              placeholder={operation.includes("pct") ? "Ex: 10" : "Ex: 5.00"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>

          {/* Push to ML toggle */}
          {field === "preco" && (
            <div className="flex items-center justify-between">
              <Label htmlFor="push-ml" className="text-sm">
                Sincronizar com Mercado Livre
              </Label>
              <Switch
                id="push-ml"
                checked={pushToMl}
                onCheckedChange={setPushToMl}
              />
            </div>
          )}

          {/* Preview */}
          {numValue > 0 && previewItems.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Preview</Label>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="p-2 text-left">SKU</th>
                      <th className="p-2 text-right">Atual</th>
                      <th className="p-2 text-right">Novo</th>
                      {field === "preco" && <th className="p-2 text-center">ML</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {previewItems.map((item) => (
                      <tr key={item.sku} className="border-t">
                        <td className="p-2 font-mono truncate max-w-[120px]">{item.sku}</td>
                        <td className="p-2 text-right text-muted-foreground">
                          {item.current.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </td>
                        <td className={`p-2 text-right font-medium ${item.newPrice > item.current ? "text-green-600" : item.newPrice < item.current ? "text-red-600" : ""}`}>
                          {item.newPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </td>
                        {field === "preco" && (
                          <td className="p-2 text-center">
                            {item.hasML && pushToMl ? (
                              <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300">Sync</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {selectedProducts.length > 10 && (
                  <div className="p-2 text-[11px] text-muted-foreground text-center border-t bg-muted/30">
                    ... e mais {selectedProducts.length - 10} produto(s)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className={`rounded-md p-3 text-sm ${result.errors.length > 0 ? "bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800" : "bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800"}`}>
              <div className="flex items-center gap-2 font-medium">
                {result.errors.length > 0 ? (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                ) : (
                  <Check className="h-4 w-4 text-green-600" />
                )}
                {result.updated} atualizado(s)
                {result.ml_synced > 0 && `, ${result.ml_synced} sincronizado(s) no ML`}
              </div>
              {result.errors.length > 0 && (
                <div className="mt-2 text-xs space-y-1">
                  {result.errors.slice(0, 5).map((e, i) => (
                    <div key={i} className="text-red-600">
                      {e.sku}: {e.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Apply button */}
          <Button
            className="w-full"
            onClick={handleApply}
            disabled={applying || numValue <= 0 || selectedIds.size === 0}
          >
            {applying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Aplicando...
              </>
            ) : (
              <>
                <DollarSign className="h-4 w-4 mr-2" />
                Aplicar Alteracoes ({selectedIds.size})
              </>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// -------------------------------------------------------------------
// Main Page
// -------------------------------------------------------------------
export default function HubProdutosPage() {
  const { workspace } = useWorkspace();
  const searchParams = useSearchParams();

  const [products, setProducts] = useState<HubProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Tabs
  const [activeTab, setActiveTab] = useState("all");
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});

  // Publish to ML inline
  const [publishingGroup, setPublishingGroup] = useState<string | null>(null);

  // Republish with different listing type
  const [republishingGroup, setRepublishingGroup] = useState<string | null>(null);

  // Expand/collapse groups
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  function toggleExpand(sku: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  }

  // Filters
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [syncFilter, setSyncFilter] = useState("");
  const [listingTypeFilter, setListingTypeFilter] = useState("");
  const [sobDemandaFilter, setSobDemandaFilter] = useState(false);

  // Modals
  const [showPullEccosys, setShowPullEccosys] = useState(false);
  const [showPushML, setShowPushML] = useState(false);
  const [showPullML, setShowPullML] = useState(false);
  const [showImportFamily, setShowImportFamily] = useState(false);
  const [showBulkPrice, setShowBulkPrice] = useState(false);
  const [linkEccosysTarget, setLinkEccosysTarget] = useState<{ mlItemId: string; nome: string } | null>(null);

  // Open modal from URL param
  useEffect(() => {
    const action = searchParams.get("action");
    if (action === "pull-eccosys") setShowPullEccosys(true);
    if (action === "push-ml") setShowPushML(true);
    if (action === "pull-ml") setShowPullML(true);
    if (action === "import-family") setShowImportFamily(true);
  }, [searchParams]);

  const fetchProducts = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), counts: "true" });
      if (activeTab && activeTab !== "all") params.set("tab", activeTab);
      if (search) params.set("search", search);
      if (sourceFilter) params.set("source", sourceFilter);
      if (syncFilter) params.set("sync_status", syncFilter);
      if (listingTypeFilter) params.set("listing_type", listingTypeFilter);
      if (sobDemandaFilter) params.set("sob_demanda", "true");

      const res = await fetch(`/api/hub/products?${params}`, {
        headers: { "x-workspace-id": workspace.id },
      });
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products);
        setTotal(data.total);
        if (data.tab_counts) setTabCounts(data.tab_counts);
      }
    } finally {
      setLoading(false);
    }
  }, [workspace?.id, page, search, sourceFilter, syncFilter, listingTypeFilter, sobDemandaFilter, activeTab]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === products.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(products.map((p) => p.id)));
    }
  }

  async function handleDelete() {
    if (!workspace?.id || selected.size === 0) return;
    if (!confirm(`Remover ${selected.size} produto(s) do Hub?`)) return;

    await fetch("/api/hub/products", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-id": workspace.id,
      },
      body: JSON.stringify({ ids: Array.from(selected) }),
    });
    setSelected(new Set());
    fetchProducts();
  }

  async function handlePublishGroup(group: ProductGroup, listingType: string = "gold_special") {
    if (!workspace?.id) return;
    const parent = group.parent;
    const allSkus = [parent.sku, ...group.children.map((c) => c.sku)];
    const categoryId = parent.ml_enrichment?.category_id;
    if (!categoryId) return;

    setPublishingGroup(parent.sku);
    try {
      const res = await fetch("/api/sync/push-ml", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspace.id,
        },
        body: JSON.stringify({ skus: allSkus, category_id: categoryId, listing_type_id: listingType }),
      });
      if (res.ok) {
        fetchProducts();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Erro ao publicar no ML");
      }
    } catch {
      alert("Erro de conexao ao publicar");
    } finally {
      setPublishingGroup(null);
    }
  }

  async function handleRepublishGroup(group: ProductGroup, listingType: string) {
    if (!workspace?.id) return;
    const parent = group.parent;
    const allSkus = [parent.sku, ...group.children.map((c) => c.sku)];

    setRepublishingGroup(parent.sku);
    try {
      const res = await fetch("/api/sync/republish-ml", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspace.id,
        },
        body: JSON.stringify({ skus: allSkus, listing_type_id: listingType }),
      });
      if (res.ok) {
        fetchProducts();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Erro ao republicar no ML");
      }
    } catch {
      alert("Erro de conexao ao republicar");
    } finally {
      setRepublishingGroup(null);
    }
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Produtos do Hub</h1>
            <p className="text-sm text-muted-foreground">
              {total} produto(s) no hub
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowImportFamily(true)}
            >
              <Package className="h-4 w-4 mr-2" />
              Importar Familia
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPullEccosys(true)}
            >
              <ArrowDownToLine className="h-4 w-4 mr-2" />
              Puxar do Eccosys
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPullML(true)}
            >
              <ArrowDownToLine className="h-4 w-4 mr-2" />
              Puxar do ML
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (selected.size > 0) {
                  setShowPushML(true);
                }
              }}
              disabled={selected.size === 0}
            >
              <ArrowUpFromLine className="h-4 w-4 mr-2" />
              Publicar no ML
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setPage(0); setSourceFilter(""); }}>
          <TabsList>
            <TabsTrigger value="all">
              Todos{tabCounts.all != null ? ` (${tabCounts.all})` : ""}
            </TabsTrigger>
            <TabsTrigger value="eccosys">
              Eccosys{tabCounts.eccosys != null ? ` (${tabCounts.eccosys})` : ""}
            </TabsTrigger>
            <TabsTrigger value="ml">
              Mercado Livre{tabCounts.ml != null ? ` (${tabCounts.ml})` : ""}
            </TabsTrigger>
            <TabsTrigger value="vinculados">
              Vinculados{tabCounts.vinculados != null ? ` (${tabCounts.vinculados})` : ""}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar SKU ou nome..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setPage(0);
                      fetchProducts();
                    }
                  }}
                  className="pl-9"
                />
              </div>
              {activeTab === "all" && (
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="eccosys">Eccosys</SelectItem>
                  <SelectItem value="ml">ML</SelectItem>
                </SelectContent>
              </Select>
              )}
              <Select value={syncFilter} onValueChange={setSyncFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="draft">Rascunho</SelectItem>
                  <SelectItem value="synced">Sincronizado</SelectItem>
                  <SelectItem value="linked">Vinculado</SelectItem>
                  <SelectItem value="error">Erro</SelectItem>
                </SelectContent>
              </Select>
              <Select value={listingTypeFilter} onValueChange={setListingTypeFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Tipo Anuncio" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="gold_special">Premium</SelectItem>
                  <SelectItem value="gold_pro">Classico</SelectItem>
                  <SelectItem value="free">Gratis</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant={sobDemandaFilter ? "default" : "outline"}
                size="sm"
                onClick={() => setSobDemandaFilter(!sobDemandaFilter)}
                className="gap-1"
              >
                <PackageOpen className="h-3.5 w-3.5" />
                Sob Demanda
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setSearch("");
                  setSourceFilter("");
                  setSyncFilter("");
                  setListingTypeFilter("");
                  setSobDemandaFilter(false);
                  setActiveTab("all");
                  setPage(0);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Bulk Actions */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border">
            <span className="text-sm font-medium">
              {selected.size} selecionado(s)
            </span>
            <Button size="sm" onClick={() => setShowPushML(true)}>
              <ArrowUpFromLine className="h-4 w-4 mr-1" />
              Publicar no ML
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowBulkPrice(true)}>
              <DollarSign className="h-4 w-4 mr-1" />
              Alterar Precos
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-1" />
              Remover
            </Button>
          </div>
        )}

        {/* Products Table */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Package className="h-10 w-10 mb-3" />
                <p className="text-sm font-medium">Nenhum produto no hub</p>
                <p className="text-xs mt-1">
                  Comece puxando produtos do Eccosys ou Mercado Livre
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => setShowPullEccosys(true)}
                >
                  <ArrowDownToLine className="h-4 w-4 mr-2" />
                  Puxar do Eccosys
                </Button>
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="p-3 w-10">
                        <input
                          type="checkbox"
                          checked={
                            selected.size === products.length &&
                            products.length > 0
                          }
                          onChange={toggleSelectAll}
                          className="rounded"
                        />
                      </th>
                      <th className="p-3 w-12"></th>
                      <th className="p-3 text-left font-medium">Produto</th>
                      <th className="p-3 text-right font-medium">Preco</th>
                      <th className="p-3 text-right font-medium">Estoque</th>
                      <th className="p-3 text-center font-medium">Source</th>
                      <th className="p-3 text-center font-medium">ML ID</th>
                      <th className="p-3 text-center font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupProducts(products).map((group) => {
                      const p = group.parent;
                      const hasChildren = group.children.length > 0;
                      const isExpanded = expandedGroups.has(p.sku);
                      const displayPreco = p.preco ?? p.ml_preco;
                      // Parent stock = sum of children when they exist
                      const displayEstoque = hasChildren
                        ? group.children.reduce((sum, c) => sum + (c.estoque ?? c.ml_estoque ?? 0), 0)
                        : (p.estoque ?? p.ml_estoque ?? 0);
                      const mlData = p.ml_data as MLData | null;

                      return (
                        <React.Fragment key={p.id}>
                          {/* -- Parent / standalone row -- */}
                          <tr
                            className={`border-t hover:bg-muted/30 ${
                              selected.has(p.id) ? "bg-primary/5" : ""
                            } ${hasChildren ? "cursor-pointer" : ""}`}
                            onClick={() => hasChildren && toggleExpand(p.sku)}
                          >
                            <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selected.has(p.id)}
                                onChange={() => toggleSelect(p.id)}
                                className="rounded"
                              />
                            </td>
                            <td className="p-3">
                              {p.fotos && p.fotos.length > 0 ? (
                                <div className="relative w-10 h-10">
                                  <Image
                                    src={p.fotos[0]}
                                    alt={p.nome || p.sku}
                                    fill
                                    className="rounded object-cover bg-muted"
                                    sizes="40px"
                                    unoptimized
                                  />
                                </div>
                              ) : (
                                <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                            </td>
                            <td className="p-3">
                              <div className="flex items-start gap-2">
                                {hasChildren && (
                                  <button
                                    type="button"
                                    className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleExpand(p.sku);
                                    }}
                                  >
                                    {isExpanded ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                  </button>
                                )}
                                <div className="min-w-0">
                                  <div className="font-medium truncate max-w-[300px]">
                                    {p.nome || p.sku}
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="font-mono text-xs text-muted-foreground">
                                      {p.sku}
                                    </span>
                                    {hasChildren && (
                                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                                        {group.children.length} var.
                                      </Badge>
                                    )}
                                  </div>
                                  {mlData && <MLDetailChips mlData={mlData} />}
                                </div>
                              </div>
                            </td>
                            <td className="p-3 text-right">
                              {workspace?.id ? (
                                <div className="flex items-center justify-end gap-1">
                                  <InlinePriceEditor
                                    productId={p.id}
                                    currentPreco={p.preco ?? p.ml_preco ?? 0}
                                    currentPrecoPromo={p.preco_promocional ?? null}
                                    workspaceId={workspace.id}
                                    onUpdated={fetchProducts}
                                  />
                                  {p.ml_item_id && p.preco != null && p.ml_preco != null && Math.abs(p.preco - p.ml_preco) > 0.01 && (
                                    <Tooltip>
                                      <TooltipTrigger>
                                        <AlertTriangle className="h-3 w-3 text-amber-500" />
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        Preco no ML difere: {p.ml_preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </div>
                              ) : (
                                <div className="font-medium">
                                  {displayPreco != null
                                    ? displayPreco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                                    : "-"}
                                </div>
                              )}
                            </td>
                            <td className="p-3 text-right">
                              {p.sob_demanda && workspace?.id && !hasChildren ? (
                                <InlineStockEditor
                                  productId={p.id}
                                  currentStock={displayEstoque}
                                  workspaceId={workspace.id}
                                  onUpdated={fetchProducts}
                                />
                              ) : (
                                <span className="font-medium">{displayEstoque}</span>
                              )}
                            </td>
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <SourceBadge source={p.source} />
                                {workspace?.id && p.ml_item_id && (
                                  <SobDemandaToggle
                                    productId={p.id}
                                    sobDemanda={p.sob_demanda}
                                    workspaceId={workspace.id}
                                    onUpdated={fetchProducts}
                                  />
                                )}
                              </div>
                            </td>
                            <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                              {p.ml_item_id ? (
                                republishingGroup === p.sku ? (
                                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled>
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    Republicando...
                                  </Button>
                                ) : (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                                        {p.ml_item_id}
                                        <ExternalLink className="h-3 w-3" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      {p.ml_permalink && (
                                        <DropdownMenuItem asChild>
                                          <a href={p.ml_permalink} target="_blank" rel="noopener noreferrer">
                                            Ver anuncio
                                            <ExternalLink className="h-3 w-3 ml-auto" />
                                          </a>
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuItem onClick={() => handleRepublishGroup(group, "gold_special")}>
                                        Republicar como Classico
                                        <span className="ml-auto text-xs text-muted-foreground">Comissao menor</span>
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => handleRepublishGroup(group, "gold_pro")}>
                                        Republicar como Premium
                                        <span className="ml-auto text-xs text-muted-foreground">Mais visibilidade</span>
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )
                              ) : p.ml_enrichment?.category_id ? (
                                publishingGroup === p.sku ? (
                                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled>
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    Publicando...
                                  </Button>
                                ) : (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                                        <Send className="h-3 w-3" />
                                        Publicar
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={() => handlePublishGroup(group, "gold_special")}>
                                        Classico
                                        <span className="ml-auto text-xs text-muted-foreground">Comissao menor</span>
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => handlePublishGroup(group, "gold_pro")}>
                                        Premium
                                        <span className="ml-auto text-xs text-muted-foreground">Mais visibilidade</span>
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="p-3 text-center">
                              {(() => {
                                const isLinked = p.sync_status === "synced" && !!p.ecc_id && !!p.ml_item_id;
                                const eccParentSku = p.ecc_id
                                  ? p.sku.startsWith("ML-")
                                    ? group.children.find((c) => c.ecc_pai_sku)?.ecc_pai_sku || null
                                    : p.sku
                                  : null;
                                // Find the Eccosys product name: check other row with same SKU, or use own nome
                                const eccRef = eccParentSku
                                  ? products.find((prod) => prod.sku === eccParentSku && prod.id !== p.id)
                                  : null;
                                const eccNome = eccRef?.nome || (eccParentSku ? p.nome : null);

                                return (
                                  <div className="flex flex-col items-center gap-1">
                                    <div className="flex items-center gap-1">
                                      <SyncBadge status={p.sync_status} eccId={p.ecc_id} mlItemId={p.ml_item_id} eccSku={eccParentSku} />
                                      {p.source === "ml" && !p.ecc_id && p.ml_item_id && (
                                        <button
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-blue-300 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:border-blue-600 dark:text-blue-400 dark:hover:bg-blue-950 transition-colors"
                                          onClick={() => setLinkEccosysTarget({ mlItemId: p.ml_item_id!, nome: p.nome || p.sku })}
                                        >
                                          <Link2 className="h-3 w-3" />
                                          Vincular
                                        </button>
                                      )}
                                    </div>
                                    {isLinked && eccParentSku && eccNome && (
                                      <div className="text-[10px] text-muted-foreground leading-tight max-w-[180px]">
                                        <span className="font-medium">{eccParentSku}</span>
                                        <br />
                                        <span className="truncate block" title={eccNome}>{eccNome}</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                          </tr>

                          {/* -- Child variation rows -- */}
                          {hasChildren && isExpanded &&
                            group.children.map((child) => {
                              const childPreco = child.preco ?? child.ml_preco;
                              const childEstoque = child.estoque ?? child.ml_estoque ?? 0;
                              const attrs = child.atributos && Object.keys(child.atributos).length > 0
                                ? Object.values(child.atributos).join(" / ")
                                : null;

                              return (
                                <tr
                                  key={child.id}
                                  className={`border-t border-dashed hover:bg-muted/30 ${
                                    selected.has(child.id) ? "bg-primary/5" : ""
                                  }`}
                                >
                                  <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                                    <input
                                      type="checkbox"
                                      checked={selected.has(child.id)}
                                      onChange={() => toggleSelect(child.id)}
                                      className="rounded"
                                    />
                                  </td>
                                  <td className="p-3">
                                    <div className="w-10 h-6 flex items-center justify-center">
                                      <div className="w-4 h-px bg-border" />
                                    </div>
                                  </td>
                                  <td className="p-3 pl-10">
                                    <div className="flex items-center gap-2">
                                      <div className="w-1 h-6 rounded-full bg-blue-400/40 shrink-0" />
                                      <div className="min-w-0">
                                        {attrs ? (
                                          <span className="text-sm">{attrs}</span>
                                        ) : (
                                          <span className="text-sm text-muted-foreground">
                                            Variacao
                                          </span>
                                        )}
                                        <div className="font-mono text-[11px] text-muted-foreground truncate max-w-[250px]">
                                          {child.sku}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="p-3 text-right">
                                    {workspace?.id ? (
                                      <InlinePriceEditor
                                        productId={child.id}
                                        currentPreco={child.preco ?? child.ml_preco ?? 0}
                                        currentPrecoPromo={child.preco_promocional ?? null}
                                        workspaceId={workspace.id}
                                        onUpdated={fetchProducts}
                                      />
                                    ) : (
                                      <span className="text-muted-foreground">
                                        {childPreco != null
                                          ? childPreco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                                          : "-"}
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-3 text-right text-muted-foreground">
                                    {child.sob_demanda && workspace?.id ? (
                                      <InlineStockEditor
                                        productId={child.id}
                                        currentStock={childEstoque}
                                        workspaceId={workspace.id}
                                        onUpdated={fetchProducts}
                                      />
                                    ) : (
                                      childEstoque
                                    )}
                                  </td>
                                  <td className="p-3" />
                                  <td className="p-3 text-center">
                                    {child.ml_variation_id && (
                                      <span className="text-[11px] font-mono text-muted-foreground">
                                        v:{child.ml_variation_id}
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-3 text-center">
                                    <SyncBadge status={child.sync_status} eccId={child.ecc_id} mlItemId={child.ml_item_id} eccSku={child.ecc_pai_sku || (child.ecc_id && !child.sku.startsWith("ML-") ? child.sku : null)} />
                                  </td>
                                </tr>
                              );
                            })}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {total > 50 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Pagina {page + 1} de {Math.ceil(total / 50)}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!products.length || products.length < 50}
                onClick={() => setPage((p) => p + 1)}
              >
                Proxima
              </Button>
            </div>
          </div>
        )}

        {/* Import Family Modal */}
        {workspace?.id && (
          <ImportFamilyModal
            open={showImportFamily}
            onClose={() => setShowImportFamily(false)}
            workspaceId={workspace.id}
            onDone={fetchProducts}
          />
        )}

        {/* Pull Eccosys Modal */}
        {workspace?.id && (
          <PullEccosysModal
            open={showPullEccosys}
            onClose={() => setShowPullEccosys(false)}
            workspaceId={workspace.id}
            onDone={fetchProducts}
          />
        )}

        {/* Push to ML Modal */}
        {workspace?.id && (
          <PushMLModal
            open={showPushML}
            onClose={() => setShowPushML(false)}
            workspaceId={workspace.id}
            selectedSkus={products
              .filter((p) => selected.has(p.id) && !p.ml_item_id)
              .map((p) => p.sku)}
            onDone={() => {
              setSelected(new Set());
              fetchProducts();
            }}
          />
        )}

        {/* Pull ML Modal */}
        {workspace?.id && (
          <PullMLModal
            open={showPullML}
            onClose={() => setShowPullML(false)}
            workspaceId={workspace.id}
            onDone={fetchProducts}
          />
        )}

        {/* Bulk Price Sheet */}
        {workspace?.id && (
          <BulkPriceSheet
            open={showBulkPrice}
            onOpenChange={setShowBulkPrice}
            workspaceId={workspace.id}
            selectedIds={selected}
            products={products}
            onDone={() => {
              fetchProducts();
            }}
          />
        )}

        {/* Link Eccosys Modal */}
        {workspace?.id && linkEccosysTarget && (
          <LinkEccosysModal
            open={!!linkEccosysTarget}
            onClose={() => setLinkEccosysTarget(null)}
            workspaceId={workspace.id}
            mlItemId={linkEccosysTarget.mlItemId}
            productName={linkEccosysTarget.nome}
            onDone={fetchProducts}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { useWorkspace } from "@/lib/workspace-context";
import type { HubProduct } from "@/types/hub";

// -------------------------------------------------------------------
// Sync status badge
// -------------------------------------------------------------------
function SyncBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: string }> = {
    draft: { label: "Rascunho", variant: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
    ready: { label: "Pronto", variant: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
    synced: { label: "Sincronizado", variant: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
    error: { label: "Erro", variant: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
  };
  const badge = map[status] || map.draft;
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.variant}`}>
      {badge.label}
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
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<{
    published: number;
    errors: number;
  } | null>(null);

  // Predict category when modal opens
  useEffect(() => {
    if (!open || selectedSkus.length === 0) return;
    setPredictions([]);
    setSelectedCategory("");
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
  quantity: number;
  status: string;
  permalink: string;
  sku: string | null;
  thumbnail: string | null;
  variations_count: number;
  already_in_hub: boolean;
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
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
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
                      <th className="p-3 text-left font-medium">ID</th>
                      <th className="p-3 text-left font-medium">Titulo</th>
                      <th className="p-3 text-right font-medium">Preco</th>
                      <th className="p-3 text-right font-medium">Qtd</th>
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
                        <td className="p-3 font-mono text-xs">
                          <a
                            href={item.permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline inline-flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {item.ml_item_id}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </td>
                        <td className="p-3 truncate max-w-[250px]">
                          {item.title}
                        </td>
                        <td className="p-3 text-right">
                          {item.price?.toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })}
                        </td>
                        <td className="p-3 text-right">{item.quantity}</td>
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

  // Filters
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [syncFilter, setSyncFilter] = useState("");

  // Modals
  const [showPullEccosys, setShowPullEccosys] = useState(false);
  const [showPushML, setShowPushML] = useState(false);
  const [showPullML, setShowPullML] = useState(false);

  // Open modal from URL param
  useEffect(() => {
    const action = searchParams.get("action");
    if (action === "pull-eccosys") setShowPullEccosys(true);
    if (action === "push-ml") setShowPushML(true);
    if (action === "pull-ml") setShowPullML(true);
  }, [searchParams]);

  const fetchProducts = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set("search", search);
      if (sourceFilter) params.set("source", sourceFilter);
      if (syncFilter) params.set("sync_status", syncFilter);

      const res = await fetch(`/api/hub/products?${params}`, {
        headers: { "x-workspace-id": workspace.id },
      });
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [workspace?.id, page, search, sourceFilter, syncFilter]);

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

  return (
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
            <Select value={syncFilter} onValueChange={setSyncFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="draft">Rascunho</SelectItem>
                <SelectItem value="synced">Sincronizado</SelectItem>
                <SelectItem value="error">Erro</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSearch("");
                setSourceFilter("");
                setSyncFilter("");
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
                    <th className="p-3 text-left font-medium">SKU</th>
                    <th className="p-3 text-left font-medium">Nome</th>
                    <th className="p-3 text-right font-medium">Preco</th>
                    <th className="p-3 text-right font-medium">Estoque</th>
                    <th className="p-3 text-center font-medium">Source</th>
                    <th className="p-3 text-center font-medium">ML ID</th>
                    <th className="p-3 text-center font-medium">Status</th>
                    <th className="p-3 text-center font-medium">Vinculado</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr
                      key={p.id}
                      className={`border-t hover:bg-muted/30 ${
                        selected.has(p.id) ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggleSelect(p.id)}
                          className="rounded"
                        />
                      </td>
                      <td className="p-3 font-mono text-xs">{p.sku}</td>
                      <td className="p-3 truncate max-w-[250px]">
                        {p.nome || "-"}
                      </td>
                      <td className="p-3 text-right">
                        {p.preco != null
                          ? p.preco.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })
                          : "-"}
                      </td>
                      <td className="p-3 text-right">{p.estoque}</td>
                      <td className="p-3 text-center">
                        <SourceBadge source={p.source} />
                      </td>
                      <td className="p-3 text-center">
                        {p.ml_item_id ? (
                          p.ml_permalink ? (
                            <a
                              href={p.ml_permalink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                            >
                              {p.ml_item_id}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-xs font-mono">
                              {p.ml_item_id}
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            -
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <SyncBadge status={p.sync_status} />
                      </td>
                      <td className="p-3 text-center">
                        {p.linked ? (
                          <Check className="h-4 w-4 text-green-500 mx-auto" />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            -
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
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
    </div>
  );
}

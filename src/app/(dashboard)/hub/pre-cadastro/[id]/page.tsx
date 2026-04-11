"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Upload,
  Sparkles,
  Send,
  Loader2,
  Trash2,
  RefreshCw,
  Check,
  AlertTriangle,
  ImagePlus,
  X,
  CheckSquare,
  Square,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkspace } from "@/lib/workspace-context";
import Link from "next/link";
import { AddProductModal } from "@/components/pre-cadastro/add-product-modal";

interface CollectionItem {
  id: string;
  original_filename: string;
  image_public_url: string;
  nome: string | null;
  codigo: string | null;
  descricao_ecommerce: string | null;
  descricao_complementar: string | null;
  descricao_detalhada: string | null;
  keywords: string | null;
  metatag_description: string | null;
  titulo_pagina: string | null;
  url_slug: string | null;
  composicao: string | null;
  preco: number | null;
  preco_custo: number | null;
  peso: number | null;
  largura: number | null;
  altura: number | null;
  comprimento: number | null;
  gtin: string | null;
  ncm: string | null;
  unidade: string | null;
  departamento_id: string | null;
  departamento_nome: string | null;
  categoria_id: string | null;
  categoria_nome: string | null;
  subcategoria_id: string | null;
  subcategoria_nome: string | null;
  images: { storage_key: string; public_url: string; is_primary: boolean }[] | null;
  ai_confidence: Record<string, number> | null;
  status: string;
  ecc_product_id: number | null;
  error_msg: string | null;
}

interface Collection {
  id: string;
  name: string;
  context_description: string | null;
  status: string;
  total_items: number;
  submitted_items: number;
  template_data: unknown;
  categories_snapshot: CategoryNode[] | null;
  grade: string[];
}

interface CategoryNode {
  id: number | string;
  nome: string;
  categorias?: { id: number | string; nome: string; subcategorias?: { id: number | string; nome: string }[] }[];
}

export default function CollectionDetailPage() {
  const params = useParams();
  const { workspace } = useWorkspace();
  const collectionId = params.id as string;

  const [collection, setCollection] = useState<Collection | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingItem, setEditingItem] = useState<CollectionItem | null>(null);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPrice, setBulkPrice] = useState("");

  const hdrs = useCallback(
    () => ({ "x-workspace-id": workspace?.id || "" }),
    [workspace?.id]
  );

  const fetchData = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const [colRes, itemsRes] = await Promise.all([
        fetch(`/api/pre-cadastro/collections/${collectionId}`, { headers: hdrs() }),
        fetch(`/api/pre-cadastro/collections/${collectionId}/items`, { headers: hdrs() }),
      ]);
      if (colRes.ok) setCollection(await colRes.json());
      if (itemsRes.ok) setItems(await itemsRes.json());
    } finally {
      setLoading(false);
    }
  }, [workspace?.id, collectionId, hdrs]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ----- Selection -----
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function selectAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  }
  const selectedItems = items.filter((i) => selected.has(i.id));
  const allSelected = items.length > 0 && selected.size === items.length;

  // ----- Bulk Actions -----
  async function handleBulkAnalyze() {
    if (!workspace?.id || selectedItems.length === 0) return;
    const ids = selectedItems.filter((i) => i.status === "pending" || i.status === "error").map((i) => i.id);
    if (ids.length === 0) return;
    setAnalyzing(true);
    await fetch("/api/pre-cadastro/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...hdrs() },
      body: JSON.stringify({ collection_id: collectionId, item_ids: ids }),
    });
    setAnalyzing(false);
    fetchData();
  }

  async function handleBulkSubmit() {
    if (!workspace?.id || !collection || selectedItems.length === 0) return;
    const ids = selectedItems.filter((i) => i.status === "ready" || i.status === "edited").map((i) => i.id);
    if (ids.length === 0) return;
    setSubmitting(true);
    setSubmitDialogOpen(true);
    await fetch("/api/pre-cadastro/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...hdrs() },
      body: JSON.stringify({ collection_id: collection.id, item_ids: ids }),
    });
    setSubmitting(false);
    setSelected(new Set());
    fetchData();
  }

  async function handleBulkPrice() {
    const price = parseFloat(bulkPrice);
    if (!price || !workspace?.id || selectedItems.length === 0) return;
    for (const item of selectedItems) {
      await fetch(`/api/pre-cadastro/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...hdrs() },
        body: JSON.stringify({ preco: price }),
      });
    }
    setBulkPrice("");
    setSelected(new Set());
    fetchData();
  }

  async function handleBulkDelete() {
    if (!workspace?.id || selectedItems.length === 0) return;
    if (!confirm(`Excluir ${selectedItems.length} produto(s)?`)) return;
    for (const item of selectedItems) {
      await fetch(`/api/pre-cadastro/items/${item.id}`, {
        method: "DELETE",
        headers: hdrs(),
      });
    }
    setSelected(new Set());
    fetchData();
  }

  // ----- Individual Actions -----
  async function handleAnalyzeItem(itemId: string) {
    if (!workspace?.id) return;
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, status: "processing" } : i)));
    await fetch("/api/pre-cadastro/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...hdrs() },
      body: JSON.stringify({ collection_id: collectionId, item_ids: [itemId] }),
    });
    fetchData();
  }

  async function handleRegenerate(itemId: string) {
    if (!workspace?.id) return;
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, status: "processing" } : i)));
    await fetch(`/api/pre-cadastro/items/${itemId}/regenerate`, {
      method: "POST",
      headers: hdrs(),
    });
    fetchData();
  }

  async function handleSubmitItem(itemId: string) {
    if (!workspace?.id || !collection) return;
    await fetch(`/api/pre-cadastro/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...hdrs() },
      body: JSON.stringify({ status: "ready" }),
    });
    setSubmitting(true);
    setSubmitDialogOpen(true);
    await fetch("/api/pre-cadastro/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...hdrs() },
      body: JSON.stringify({ collection_id: collection.id, item_ids: [itemId] }),
    });
    setSubmitting(false);
    fetchData();
  }

  async function handleUploadImage(itemId: string) {
    if (!workspace?.id) return;
    const res = await fetch(`/api/pre-cadastro/items/${itemId}/upload-image`, {
      method: "POST",
      headers: hdrs(),
    });
    const data = await res.json();
    if (res.ok && data.uploaded > 0) {
      alert(`${data.uploaded} imagem(ns) enviada(s) para ${data.codigo}`);
    } else {
      alert(`Erro: ${data.error || "Nenhuma imagem enviada"}`);
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (!workspace?.id) return;
    await fetch(`/api/pre-cadastro/items/${itemId}`, { method: "DELETE", headers: hdrs() });
    fetchData();
  }

  async function handleSaveEdit(itemId: string, updates: Record<string, unknown>) {
    if (!workspace?.id) return;
    await fetch(`/api/pre-cadastro/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...hdrs() },
      body: JSON.stringify(updates),
    });
    setEditingItem(null);
    fetchData();
  }

  // ----- Counts -----
  const pendingCount = items.filter((i) => i.status === "pending" || i.status === "error").length;
  const readyCount = items.filter((i) => i.status === "ready" || i.status === "edited").length;
  const submittedCount = items.filter((i) => i.status === "submitted").length;
  const selectedPending = selectedItems.filter((i) => i.status === "pending" || i.status === "error").length;
  const selectedReady = selectedItems.filter((i) => i.status === "ready" || i.status === "edited").length;

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!collection) {
    return <p className="text-muted-foreground">Colecao nao encontrada</p>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/hub/pre-cadastro"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{collection.name}</h1>
          {collection.context_description && (
            <p className="text-sm text-muted-foreground line-clamp-1">{collection.context_description}</p>
          )}
        </div>
        <Button onClick={() => setShowAddProduct(true)}>
          <ImagePlus className="mr-2 h-4 w-4" />
          Cadastrar Produto
        </Button>
      </div>

      <AddProductModal open={showAddProduct} onOpenChange={setShowAddProduct} collectionId={collectionId} onCreated={fetchData} />

      {/* Stats Bar */}
      {items.length > 0 && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{items.length} produtos</span>
          {pendingCount > 0 && <Badge variant="secondary">{pendingCount} pendentes</Badge>}
          {readyCount > 0 && <Badge variant="outline" className="border-green-500 text-green-600">{readyCount} prontos</Badge>}
          {submittedCount > 0 && <Badge variant="default">{submittedCount} enviados</Badge>}
          <span className="text-xs">Grade: {collection.grade?.join(", ") || "P, M, G, GG, XGG"}</span>
        </div>
      )}

      {/* Selection Toolbar */}
      {items.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              {/* Select all */}
              <button type="button" onClick={selectAll} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                {allSelected ? "Desmarcar" : "Selecionar tudo"}
              </button>

              {selected.size > 0 && (
                <>
                  <span className="text-xs font-medium">{selected.size} selecionado(s)</span>
                  <div className="h-4 w-px bg-border" />

                  {/* Bulk Price */}
                  <div className="flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Preco"
                      value={bulkPrice}
                      onChange={(e) => setBulkPrice(e.target.value)}
                      className="w-20 h-7 text-xs"
                    />
                    <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={handleBulkPrice} disabled={!bulkPrice}>
                      Aplicar
                    </Button>
                  </div>

                  <div className="h-4 w-px bg-border" />

                  {/* Bulk Analyze */}
                  {selectedPending > 0 && (
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleBulkAnalyze} disabled={analyzing}>
                      {analyzing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                      Analisar ({selectedPending})
                    </Button>
                  )}

                  {/* Bulk Submit */}
                  {selectedReady > 0 && (
                    <Button size="sm" className="h-7 text-xs" onClick={handleBulkSubmit} disabled={submitting}>
                      {submitting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
                      Enviar ({selectedReady})
                    </Button>
                  )}

                  {/* Bulk Delete */}
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-red-600 ml-auto" onClick={handleBulkDelete}>
                    <Trash2 className="mr-1 h-3 w-3" />
                    Excluir
                  </Button>
                </>
              )}

              {selected.size === 0 && (
                <span className="text-xs text-muted-foreground">Selecione produtos para acoes em massa</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Analyze Progress */}
      {analyzing && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Sparkles className="h-4 w-4 text-primary animate-pulse" />
              <div className="flex-1">
                <p className="text-sm font-medium">Analisando imagens com IA...</p>
                <Progress value={50} className="h-1.5 mt-1" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <ImagePlus className="h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">Nenhum produto cadastrado</p>
            <Button onClick={() => setShowAddProduct(true)} variant="outline">
              <ImagePlus className="mr-2 h-4 w-4" />
              Cadastrar Produto
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Product Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item) => (
          <ProductCard
            key={item.id}
            item={item}
            isSelected={selected.has(item.id)}
            onToggleSelect={() => toggleSelect(item.id)}
            onDelete={() => handleDeleteItem(item.id)}
            onAnalyze={() => handleAnalyzeItem(item.id)}
            onRegenerate={() => handleRegenerate(item.id)}
            onEdit={() => setEditingItem(item)}
            onSubmit={() => handleSubmitItem(item.id)}
            onUploadImage={() => handleUploadImage(item.id)}
          />
        ))}
      </div>

      {/* Edit Dialog */}
      {editingItem && (
        <EditItemDialog
          item={editingItem}
          categories={collection.categories_snapshot}
          onClose={() => setEditingItem(null)}
          onSave={(updates) => handleSaveEdit(editingItem.id, updates)}
        />
      )}

      {/* Submit Progress Dialog */}
      <Dialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Enviando para Eccosys</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {submitting ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Criando produtos no Eccosys...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-4">
                <Check className="h-8 w-8 text-green-600" />
                <p className="text-sm font-medium">Envio concluido!</p>
                <Button onClick={() => setSubmitDialogOpen(false)}>Fechar</Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ----- Product Card -----

function ProductCard({
  item,
  isSelected,
  onToggleSelect,
  onDelete,
  onAnalyze,
  onRegenerate,
  onEdit,
  onSubmit,
  onUploadImage,
}: {
  item: CollectionItem;
  isSelected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  onAnalyze: () => void;
  onRegenerate: () => void;
  onEdit: () => void;
  onSubmit: () => void;
  onUploadImage: () => void;
}) {
  const confidence = item.ai_confidence || {};
  const lowConfidenceFields = Object.entries(confidence)
    .filter(([, v]) => v < 0.5)
    .map(([k]) => k);

  const statusConfig: Record<string, { color: string; label: string }> = {
    pending: { color: "text-muted-foreground", label: "Pendente" },
    processing: { color: "text-blue-600", label: "Processando" },
    ready: { color: "text-green-600", label: "Pronto" },
    edited: { color: "text-green-600", label: "Editado" },
    submitted: { color: "text-primary", label: "Enviado" },
    error: { color: "text-red-600", label: "Erro" },
  };
  const status = statusConfig[item.status] || statusConfig.pending;

  return (
    <Card className={`overflow-hidden transition-all ${isSelected ? "ring-2 ring-primary" : ""}`}>
      {/* Image */}
      <div className="aspect-square bg-muted relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.image_public_url} alt={item.nome || item.original_filename} className="w-full h-full object-cover" />

        {/* Select checkbox */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          className="absolute top-2 left-2 bg-white/80 dark:bg-black/60 rounded p-0.5"
        >
          {isSelected ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5 text-muted-foreground" />}
        </button>

        <div className="absolute top-2 right-2">
          <Badge variant={item.status === "error" ? "destructive" : item.status === "submitted" ? "default" : "secondary"} className="text-xs">
            {status.label}
          </Badge>
        </div>

        {item.status === "processing" && (
          <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}
      </div>

      <CardContent className="p-4 space-y-2">
        {item.nome ? (
          <>
            <h3 className="font-semibold text-sm line-clamp-2">{item.nome}</h3>
            <p className="text-xs text-muted-foreground">{item.codigo}</p>

            {item.descricao_ecommerce && (
              <p className="text-xs text-muted-foreground line-clamp-2">{item.descricao_ecommerce}</p>
            )}

            {item.departamento_nome && (
              <p className="text-xs">{item.departamento_nome}</p>
            )}
            {item.composicao && (
              <p className="text-xs text-muted-foreground">{item.composicao}</p>
            )}

            {lowConfidenceFields.length > 0 && (
              <div className="flex items-center gap-1 text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                <span className="text-xs">Revisar: {lowConfidenceFields.join(", ")}</span>
              </div>
            )}

            <div className="flex gap-3 text-xs text-muted-foreground">
              {item.preco && <span>R$ {Number(item.preco).toFixed(2)}</span>}
              {item.peso && <span>{item.peso}kg</span>}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{item.original_filename}</p>
        )}

        {item.error_msg && <p className="text-xs text-red-600 line-clamp-2">{item.error_msg}</p>}

        {item.nome && !item.preco && item.status !== "pending" && (
          <p className="text-xs text-amber-600">Preco de venda obrigatorio</p>
        )}

        {item.codigo && item.status === "submitted" && (
          <p className="text-xs text-green-600">Eccosys: {item.codigo}</p>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-1 pt-1 border-t">
          {(item.status === "pending" || item.status === "error") && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" onClick={onAnalyze}>
              <Sparkles className="h-3 w-3 mr-1" />
              Analisar
            </Button>
          )}
          {item.nome && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onEdit}>
              Editar
            </Button>
          )}
          {(item.status === "ready" || item.status === "edited") && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" onClick={onSubmit}>
              <Send className="h-3 w-3 mr-1" />
              Enviar
            </Button>
          )}
          {(item.status === "submitted" || item.status === "error") && item.nome && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" onClick={onSubmit}>
              <Send className="h-3 w-3 mr-1" />
              Reenviar
            </Button>
          )}
          {item.status === "submitted" && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onUploadImage}>
              <Upload className="h-3 w-3 mr-1" />
              Imagem
            </Button>
          )}
          {(item.status === "ready" || item.status === "edited" || item.status === "submitted") && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onRegenerate}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Re-analisar
            </Button>
          )}
          {item.status !== "submitted" && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-red-600 ml-auto" onClick={onDelete}>
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ----- Edit Item Dialog -----

function EditItemDialog({
  item,
  categories,
  onClose,
  onSave,
}: {
  item: CollectionItem;
  categories: CategoryNode[] | null;
  onClose: () => void;
  onSave: (updates: Record<string, unknown>) => void;
}) {
  const { workspace } = useWorkspace();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [itemImages, setItemImages] = useState<{ storage_key: string; public_url: string; is_primary: boolean }[]>(
    item.images && item.images.length > 0
      ? item.images
      : item.image_public_url ? [{ storage_key: item.image_public_url, public_url: item.image_public_url, is_primary: true }] : []
  );
  const [uploadingImg, setUploadingImg] = useState(false);

  async function handleAddImages(files: FileList | null) {
    if (!files || !workspace?.id) return;
    setUploadingImg(true);
    for (const file of Array.from(files)) {
      try {
        const urlRes = await fetch("/api/media/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, mime_type: file.type }),
        });
        if (!urlRes.ok) continue;
        const { signedUrl, key, publicUrl } = await urlRes.json();
        await fetch(signedUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        setItemImages((prev) => [...prev, { storage_key: key, public_url: publicUrl, is_primary: false }]);
      } catch (err) {
        console.error("Erro upload:", err);
      }
    }
    setUploadingImg(false);
  }

  function removeImg(index: number) {
    setItemImages((prev) => prev.filter((_, i) => i !== index));
  }

  const [form, setForm] = useState({
    nome: item.nome || "",
    codigo: item.codigo || "",
    descricao_ecommerce: item.descricao_ecommerce || "",
    descricao_complementar: item.descricao_complementar || "",
    descricao_detalhada: item.descricao_detalhada || "",
    keywords: item.keywords || "",
    metatag_description: item.metatag_description || "",
    titulo_pagina: item.titulo_pagina || "",
    url_slug: item.url_slug || "",
    composicao: item.composicao || "",
    preco: item.preco != null ? String(item.preco) : "",
    preco_custo: item.preco_custo != null ? String(item.preco_custo) : "",
    peso: item.peso != null ? String(item.peso) : "",
    largura: item.largura != null ? String(item.largura) : "",
    altura: item.altura != null ? String(item.altura) : "",
    comprimento: item.comprimento != null ? String(item.comprimento) : "",
    ncm: item.ncm || "",
    departamento_id: item.departamento_id || "",
  });

  const confidence = item.ai_confidence || {};
  function fieldClass(field: string) {
    return (confidence[field] ?? 1) < 0.5 ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20" : "";
  }

  function handleSave() {
    const updates: Record<string, unknown> = {};
    const str = (v: string | null) => v || "";
    const num = (v: number | null) => v != null ? String(v) : "";

    if (form.nome !== str(item.nome)) updates.nome = form.nome;
    if (form.descricao_ecommerce !== str(item.descricao_ecommerce)) updates.descricao_ecommerce = form.descricao_ecommerce;
    if (form.descricao_complementar !== str(item.descricao_complementar)) updates.descricao_complementar = form.descricao_complementar;
    if (form.descricao_detalhada !== str(item.descricao_detalhada)) updates.descricao_detalhada = form.descricao_detalhada;
    if (form.keywords !== str(item.keywords)) updates.keywords = form.keywords;
    if (form.metatag_description !== str(item.metatag_description)) updates.metatag_description = form.metatag_description;
    if (form.titulo_pagina !== str(item.titulo_pagina)) updates.titulo_pagina = form.titulo_pagina;
    if (form.url_slug !== str(item.url_slug)) updates.url_slug = form.url_slug;
    if (form.composicao !== str(item.composicao)) updates.composicao = form.composicao;
    if (form.preco !== num(item.preco)) updates.preco = form.preco ? parseFloat(form.preco) : null;
    if (form.preco_custo !== num(item.preco_custo)) updates.preco_custo = form.preco_custo ? parseFloat(form.preco_custo) : null;
    if (form.peso !== num(item.peso)) updates.peso = form.peso ? parseFloat(form.peso) : null;
    if (form.largura !== num(item.largura)) updates.largura = form.largura ? parseFloat(form.largura) : null;
    if (form.altura !== num(item.altura)) updates.altura = form.altura ? parseFloat(form.altura) : null;
    if (form.comprimento !== num(item.comprimento)) updates.comprimento = form.comprimento ? parseFloat(form.comprimento) : null;
    if (form.ncm !== str(item.ncm)) updates.ncm = form.ncm || null;
    if (form.departamento_id !== str(item.departamento_id)) {
      updates.departamento_id = form.departamento_id || null;
      const dept = categories?.find((d) => String(d.id) === form.departamento_id);
      updates.departamento_nome = dept?.nome || null;
    }

    // Save images if changed
    const origImages = item.images || [];
    if (JSON.stringify(itemImages) !== JSON.stringify(origImages)) {
      updates.images = itemImages;
      if (itemImages.length > 0) {
        updates.image_public_url = itemImages[0].public_url;
        updates.image_storage_key = itemImages[0].storage_key;
      }
    }

    onSave(Object.keys(updates).length > 0 ? updates : { nome: form.nome });
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Editar Produto</DialogTitle></DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          {/* Left: images grid */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1.5">
              {itemImages.map((img, i) => (
                <div key={i} className="relative aspect-square rounded-md overflow-hidden border bg-muted group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.public_url} alt="" className="w-full h-full object-cover" />
                  {i === 0 && <span className="absolute top-0.5 left-0.5 bg-primary text-primary-foreground text-[9px] px-1 py-0.5 rounded">Principal</span>}
                  <button type="button" onClick={() => removeImg(i)} className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => fileInputRef.current?.click()} className="aspect-square rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-1 hover:border-primary/50 transition-colors">
                {uploadingImg ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4 text-muted-foreground" />}
                <span className="text-[9px] text-muted-foreground">Adicionar</span>
              </button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => handleAddImages(e.target.files)} />
          </div>

          {/* Right: core fields */}
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nome</Label>
              <Input className={fieldClass("nome")} value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">URL / Slug</Label>
              <Input value={form.url_slug} onChange={(e) => setForm((f) => ({ ...f, url_slug: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Composicao</Label>
              <Input value={form.composicao} onChange={(e) => setForm((f) => ({ ...f, composicao: e.target.value }))} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Preco (R$)</Label>
                <Input type="number" step="0.01" value={form.preco} onChange={(e) => setForm((f) => ({ ...f, preco: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Custo (R$)</Label>
                <Input type="number" step="0.01" value={form.preco_custo} onChange={(e) => setForm((f) => ({ ...f, preco_custo: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">NCM</Label>
                <Input value={form.ncm} onChange={(e) => setForm((f) => ({ ...f, ncm: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Peso (kg)</Label>
                <Input type="number" step="0.001" value={form.peso} onChange={(e) => setForm((f) => ({ ...f, peso: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Dimensoes (CxLxA cm)</Label>
                <div className="flex gap-1">
                  <Input type="number" step="0.1" placeholder="C" value={form.comprimento} onChange={(e) => setForm((f) => ({ ...f, comprimento: e.target.value }))} />
                  <Input type="number" step="0.1" placeholder="L" value={form.largura} onChange={(e) => setForm((f) => ({ ...f, largura: e.target.value }))} />
                  <Input type="number" step="0.1" placeholder="A" value={form.altura} onChange={(e) => setForm((f) => ({ ...f, altura: e.target.value }))} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Category */}
        {categories && categories.length > 0 && (
          <div className="mt-4">
            <Label className="text-xs">Categoria</Label>
            <Select value={form.departamento_id} onValueChange={(v) => setForm((f) => ({ ...f, departamento_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Selecione a categoria" /></SelectTrigger>
              <SelectContent>{categories.map((d) => (<SelectItem key={String(d.id)} value={String(d.id)}>{d.nome}</SelectItem>))}</SelectContent>
            </Select>
          </div>
        )}

        {/* Descriptions */}
        <div className="space-y-3 mt-4">
          <div>
            <Label className="text-xs">Descricao Complementar</Label>
            <Textarea rows={2} value={form.descricao_complementar} onChange={(e) => setForm((f) => ({ ...f, descricao_complementar: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Descricao E-commerce</Label>
            <Textarea rows={3} value={form.descricao_ecommerce} onChange={(e) => setForm((f) => ({ ...f, descricao_ecommerce: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Descricao Detalhada</Label>
            <Textarea rows={4} value={form.descricao_detalhada} onChange={(e) => setForm((f) => ({ ...f, descricao_detalhada: e.target.value }))} />
          </div>
        </div>

        {/* SEO */}
        <div className="space-y-3 mt-4">
          <div>
            <Label className="text-xs">Titulo da Pagina (SEO)</Label>
            <Input value={form.titulo_pagina} onChange={(e) => setForm((f) => ({ ...f, titulo_pagina: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Keywords (SEO)</Label>
            <Textarea rows={2} value={form.keywords} onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Metatag Description (SEO)</Label>
            <Textarea rows={2} value={form.metatag_description} onChange={(e) => setForm((f) => ({ ...f, metatag_description: e.target.value }))} />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave}><Check className="mr-2 h-4 w-4" />Salvar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

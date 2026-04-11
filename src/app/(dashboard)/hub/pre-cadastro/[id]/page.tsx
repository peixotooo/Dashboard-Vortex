"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Upload, Sparkles, Send, Loader2, Trash2, RefreshCw,
  Check, AlertTriangle, ImagePlus, X, CheckSquare, Square,
  DollarSign, LayoutGrid, List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  id: string; name: string; context_description: string | null; status: string;
  total_items: number; submitted_items: number; template_data: unknown;
  categories_snapshot: CategoryNode[] | null; grade: string[];
}

interface CategoryNode {
  id: number | string; nome: string;
  categorias?: { id: number | string; nome: string; subcategorias?: { id: number | string; nome: string }[] }[];
}

type BulkMode = null | "price" | "select";

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
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [bulkMode, setBulkMode] = useState<BulkMode>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPrice, setBulkPrice] = useState("");

  const hdrs = useCallback(() => ({ "x-workspace-id": workspace?.id || "" }), [workspace?.id]);

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
    } finally { setLoading(false); }
  }, [workspace?.id, collectionId, hdrs]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Selection
  function toggleSelect(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectAll() {
    setSelected(selected.size === items.length ? new Set() : new Set(items.map((i) => i.id)));
  }
  function cancelBulk() { setBulkMode(null); setSelected(new Set()); setBulkPrice(""); }

  // Bulk actions
  async function handleBulkAnalyze() {
    if (!workspace?.id) return;
    const ids = items.filter((i) => i.status === "pending" || i.status === "error").map((i) => i.id);
    if (ids.length === 0) return;
    setAnalyzing(true);
    await fetch("/api/pre-cadastro/analyze", {
      method: "POST", headers: { "Content-Type": "application/json", ...hdrs() },
      body: JSON.stringify({ collection_id: collectionId, item_ids: ids }),
    });
    setAnalyzing(false); fetchData();
  }

  async function handleBulkSubmit() {
    if (!workspace?.id || !collection) return;
    const ids = items.filter((i) => i.status === "ready" || i.status === "edited").map((i) => i.id);
    if (ids.length === 0) return;
    setSubmitting(true); setSubmitDialogOpen(true);
    await fetch("/api/pre-cadastro/submit", {
      method: "POST", headers: { "Content-Type": "application/json", ...hdrs() },
      body: JSON.stringify({ collection_id: collection.id, item_ids: ids }),
    });
    setSubmitting(false); fetchData();
  }

  async function handleApplyPrice() {
    const price = parseFloat(bulkPrice);
    if (!price || !workspace?.id || selected.size === 0) return;
    for (const id of selected) {
      await fetch(`/api/pre-cadastro/items/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...hdrs() },
        body: JSON.stringify({ preco: price }),
      });
    }
    cancelBulk(); fetchData();
  }

  // Individual actions
  async function handleAnalyzeItem(id: string) {
    if (!workspace?.id) return;
    setItems((p) => p.map((i) => (i.id === id ? { ...i, status: "processing" } : i)));
    await fetch("/api/pre-cadastro/analyze", {
      method: "POST", headers: { "Content-Type": "application/json", ...hdrs() },
      body: JSON.stringify({ collection_id: collectionId, item_ids: [id] }),
    }); fetchData();
  }
  async function handleRegenerate(id: string) {
    if (!workspace?.id) return;
    setItems((p) => p.map((i) => (i.id === id ? { ...i, status: "processing" } : i)));
    await fetch(`/api/pre-cadastro/items/${id}/regenerate`, { method: "POST", headers: hdrs() });
    fetchData();
  }
  async function handleSubmitItem(id: string) {
    if (!workspace?.id || !collection) return;
    await fetch(`/api/pre-cadastro/items/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...hdrs() },
      body: JSON.stringify({ status: "ready" }),
    });
    setSubmitting(true); setSubmitDialogOpen(true);
    await fetch("/api/pre-cadastro/submit", {
      method: "POST", headers: { "Content-Type": "application/json", ...hdrs() },
      body: JSON.stringify({ collection_id: collection.id, item_ids: [id] }),
    });
    setSubmitting(false); fetchData();
  }
  async function handleUploadImage(id: string) {
    if (!workspace?.id) return;
    const res = await fetch(`/api/pre-cadastro/items/${id}/upload-image`, { method: "POST", headers: hdrs() });
    const data = await res.json();
    alert(res.ok && data.uploaded > 0 ? `${data.uploaded} imagem(ns) enviada(s) para ${data.codigo}` : `Erro: ${data.error || "Nenhuma imagem"}`);
  }
  async function handleDeleteItem(id: string) {
    if (!workspace?.id) return;
    await fetch(`/api/pre-cadastro/items/${id}`, { method: "DELETE", headers: hdrs() }); fetchData();
  }
  async function handleSaveEdit(id: string, updates: Record<string, unknown>) {
    if (!workspace?.id) return;
    await fetch(`/api/pre-cadastro/items/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...hdrs() },
      body: JSON.stringify(updates),
    });
    setEditingItem(null); fetchData();
  }

  // Counts
  const pendingCount = items.filter((i) => i.status === "pending" || i.status === "error").length;
  const readyCount = items.filter((i) => i.status === "ready" || i.status === "edited").length;
  const submittedCount = items.filter((i) => i.status === "submitted").length;

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!collection) return <p className="text-muted-foreground">Colecao nao encontrada</p>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/hub/pre-cadastro"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{collection.name}</h1>
          {collection.context_description && <p className="text-xs text-muted-foreground line-clamp-1">{collection.context_description}</p>}
        </div>
        <Button onClick={() => setShowAddProduct(true)} size="sm">
          <ImagePlus className="mr-2 h-4 w-4" />Cadastrar Produto
        </Button>
      </div>

      <AddProductModal open={showAddProduct} onOpenChange={setShowAddProduct} collectionId={collectionId} onCreated={fetchData} />

      {/* Action Bar */}
      {items.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {/* Stats */}
          <div className="flex items-center gap-2 mr-auto">
            <span className="text-xs text-muted-foreground">{items.length} produtos</span>
            {pendingCount > 0 && <Badge variant="secondary" className="text-xs">{pendingCount} pendentes</Badge>}
            {readyCount > 0 && <Badge variant="outline" className="text-xs border-green-500 text-green-600">{readyCount} prontos</Badge>}
            {submittedCount > 0 && <Badge className="text-xs">{submittedCount} enviados</Badge>}
          </div>

          {/* Bulk price mode */}
          {bulkMode === "price" ? (
            <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-1.5">
              <span className="text-xs font-medium">Selecione os produtos e defina o preco:</span>
              <Input type="number" step="0.01" placeholder="R$" value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} className="w-24 h-7 text-xs" />
              <Button size="sm" className="h-7 text-xs" onClick={handleApplyPrice} disabled={!bulkPrice || selected.size === 0}>
                Aplicar ({selected.size})
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={cancelBulk}>Cancelar</Button>
            </div>
          ) : (
            <>
              {/* Primary actions */}
              {pendingCount > 0 && (
                <Button variant="outline" size="sm" onClick={handleBulkAnalyze} disabled={analyzing}>
                  {analyzing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
                  Analisar todos ({pendingCount})
                </Button>
              )}
              {readyCount > 0 && (
                <Button size="sm" onClick={handleBulkSubmit} disabled={submitting}>
                  {submitting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-2 h-3.5 w-3.5" />}
                  Enviar todos ({readyCount})
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setBulkMode("price")}>
                <DollarSign className="mr-1 h-3.5 w-3.5" />Preco em massa
              </Button>

              {/* View toggle */}
              <div className="flex border rounded-md">
                <Button variant={viewMode === "grid" ? "secondary" : "ghost"} size="icon" className="h-8 w-8 rounded-r-none" onClick={() => setViewMode("grid")}>
                  <LayoutGrid className="h-3.5 w-3.5" />
                </Button>
                <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="icon" className="h-8 w-8 rounded-l-none" onClick={() => setViewMode("list")}>
                  <List className="h-3.5 w-3.5" />
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Select all bar (only in bulk mode) */}
      {bulkMode && items.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <button type="button" onClick={selectAll} className="flex items-center gap-1 hover:text-foreground">
            {selected.size === items.length ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
            {selected.size === items.length ? "Desmarcar tudo" : "Selecionar tudo"}
          </button>
          {selected.size > 0 && <span className="font-medium text-foreground">{selected.size} selecionado(s)</span>}
        </div>
      )}

      {/* Progress */}
      {analyzing && (
        <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
          <Sparkles className="h-4 w-4 text-primary animate-pulse" />
          <p className="text-sm">Analisando com IA...</p>
          <Progress value={50} className="h-1.5 flex-1" />
        </div>
      )}

      {/* Empty */}
      {items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
            <ImagePlus className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhum produto cadastrado</p>
            <Button variant="outline" size="sm" onClick={() => setShowAddProduct(true)}>Cadastrar Produto</Button>
          </CardContent>
        </Card>
      )}

      {/* Grid View */}
      {viewMode === "grid" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => (
            <GridCard key={item.id} item={item} showCheckbox={!!bulkMode} isSelected={selected.has(item.id)}
              onToggle={() => toggleSelect(item.id)} onEdit={() => setEditingItem(item)}
              onAnalyze={() => handleAnalyzeItem(item.id)} onRegenerate={() => handleRegenerate(item.id)}
              onSubmit={() => handleSubmitItem(item.id)} onUploadImage={() => handleUploadImage(item.id)}
              onDelete={() => handleDeleteItem(item.id)} />
          ))}
        </div>
      )}

      {/* List View */}
      {viewMode === "list" && (
        <div className="space-y-1">
          {items.map((item) => (
            <ListRow key={item.id} item={item} showCheckbox={!!bulkMode} isSelected={selected.has(item.id)}
              onToggle={() => toggleSelect(item.id)} onEdit={() => setEditingItem(item)}
              onAnalyze={() => handleAnalyzeItem(item.id)} onRegenerate={() => handleRegenerate(item.id)}
              onSubmit={() => handleSubmitItem(item.id)} onUploadImage={() => handleUploadImage(item.id)}
              onDelete={() => handleDeleteItem(item.id)} />
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      {editingItem && <EditItemDialog item={editingItem} categories={collection.categories_snapshot} onClose={() => setEditingItem(null)} onSave={(u) => handleSaveEdit(editingItem.id, u)} />}

      {/* Submit Dialog */}
      <Dialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Enviando para Eccosys</DialogTitle></DialogHeader>
          {submitting ? (
            <div className="flex flex-col items-center gap-3 py-6"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="text-sm text-muted-foreground">Criando produtos...</p></div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-6"><Check className="h-8 w-8 text-green-600" /><p className="text-sm font-medium">Concluido!</p><Button onClick={() => setSubmitDialogOpen(false)}>Fechar</Button></div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ========== Grid Card ==========

interface CardProps {
  item: CollectionItem; showCheckbox: boolean; isSelected: boolean;
  onToggle: () => void; onEdit: () => void; onAnalyze: () => void;
  onRegenerate: () => void; onSubmit: () => void; onUploadImage: () => void; onDelete: () => void;
}

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pendente", variant: "secondary" },
  processing: { label: "Processando", variant: "secondary" },
  ready: { label: "Pronto", variant: "outline" },
  edited: { label: "Editado", variant: "outline" },
  submitted: { label: "Enviado", variant: "default" },
  error: { label: "Erro", variant: "destructive" },
};

function GridCard({ item, showCheckbox, isSelected, onToggle, onEdit, onAnalyze, onRegenerate, onSubmit, onUploadImage, onDelete }: CardProps) {
  const badge = STATUS_BADGE[item.status] || STATUS_BADGE.pending;

  return (
    <Card className={`overflow-hidden transition-all ${isSelected ? "ring-2 ring-primary" : ""}`}>
      <div className="aspect-[4/3] bg-muted relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.image_public_url} alt={item.nome || ""} className="w-full h-full object-cover" />
        {showCheckbox && (
          <button type="button" onClick={onToggle} className="absolute top-2 left-2 bg-white/90 dark:bg-black/60 rounded p-0.5">
            {isSelected ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5 text-muted-foreground" />}
          </button>
        )}
        <Badge variant={badge.variant} className="absolute top-2 right-2 text-[10px]">{badge.label}</Badge>
        {item.status === "processing" && <div className="absolute inset-0 bg-background/50 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>}
      </div>

      <CardContent className="p-3 space-y-1.5">
        <h3 className="font-semibold text-sm line-clamp-1">{item.nome || item.original_filename}</h3>

        {item.nome && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {item.departamento_nome && <span>{item.departamento_nome}</span>}
            {item.preco ? <span className="font-medium text-foreground">R$ {Number(item.preco).toFixed(2)}</span> : <span className="text-amber-600">Sem preco</span>}
          </div>
        )}

        {item.error_msg && <p className="text-[10px] text-red-600 line-clamp-1">{item.error_msg}</p>}
        {item.codigo && item.status === "submitted" && <p className="text-[10px] text-green-600">Eccosys: {item.codigo}</p>}

        {/* Clean action row */}
        <div className="flex items-center gap-0.5 pt-1.5 border-t">
          {(item.status === "pending" || item.status === "error") && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onAnalyze} title="Analisar com IA"><Sparkles className="h-3.5 w-3.5 text-primary" /></Button>
          )}
          {item.nome && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="Editar"><span className="text-xs">Editar</span></Button>}
          {(item.status === "ready" || item.status === "edited") && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onSubmit} title="Enviar para Eccosys"><Send className="h-3.5 w-3.5 text-primary" /></Button>
          )}
          {(item.status === "submitted" || item.status === "error") && item.nome && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onSubmit} title="Reenviar"><Send className="h-3.5 w-3.5" /></Button>
          )}
          {item.status === "submitted" && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onUploadImage} title="Enviar imagens"><Upload className="h-3.5 w-3.5" /></Button>
          )}
          {(item.status === "ready" || item.status === "edited" || item.status === "submitted") && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRegenerate} title="Re-analisar com IA"><RefreshCw className="h-3.5 w-3.5" /></Button>
          )}
          {item.status !== "submitted" && (
            <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={onDelete} title="Excluir"><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ========== List Row ==========

function ListRow({ item, showCheckbox, isSelected, onToggle, onEdit, onAnalyze, onRegenerate, onSubmit, onUploadImage, onDelete }: CardProps) {
  const badge = STATUS_BADGE[item.status] || STATUS_BADGE.pending;

  return (
    <div className={`flex items-center gap-3 p-2 rounded-lg border transition-all hover:bg-muted/30 ${isSelected ? "ring-2 ring-primary bg-muted/20" : ""}`}>
      {showCheckbox && (
        <button type="button" onClick={onToggle}>
          {isSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
        </button>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.image_public_url} alt="" className="h-12 w-12 rounded object-cover bg-muted flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{item.nome || item.original_filename}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {item.departamento_nome && <span>{item.departamento_nome}</span>}
          {item.composicao && <span>{item.composicao}</span>}
          {item.codigo && item.status === "submitted" && <span className="text-green-600">{item.codigo}</span>}
        </div>
      </div>

      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {item.preco ? <span className="font-medium text-foreground">R$ {Number(item.preco).toFixed(2)}</span> : <span className="text-amber-600">Sem preco</span>}
      </div>

      <Badge variant={badge.variant} className="text-[10px] flex-shrink-0">{badge.label}</Badge>

      {/* Actions */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {(item.status === "pending" || item.status === "error") && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onAnalyze} title="Analisar"><Sparkles className="h-3.5 w-3.5 text-primary" /></Button>}
        {item.nome && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="Editar"><span className="text-[10px]">Editar</span></Button>}
        {(item.status === "ready" || item.status === "edited") && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onSubmit} title="Enviar"><Send className="h-3.5 w-3.5 text-primary" /></Button>}
        {(item.status === "submitted" || item.status === "error") && item.nome && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onSubmit} title="Reenviar"><Send className="h-3.5 w-3.5" /></Button>}
        {item.status === "submitted" && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onUploadImage} title="Imagens"><Upload className="h-3.5 w-3.5" /></Button>}
        {(item.status === "ready" || item.status === "edited" || item.status === "submitted") && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRegenerate} title="Re-analisar"><RefreshCw className="h-3.5 w-3.5" /></Button>}
        {item.status !== "submitted" && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete} title="Excluir"><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>}
      </div>
    </div>
  );
}

// ========== Edit Dialog ==========

function EditItemDialog({ item, categories, onClose, onSave }: {
  item: CollectionItem; categories: CategoryNode[] | null;
  onClose: () => void; onSave: (updates: Record<string, unknown>) => void;
}) {
  const { workspace } = useWorkspace();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [itemImages, setItemImages] = useState<{ storage_key: string; public_url: string; is_primary: boolean }[]>(
    item.images && item.images.length > 0 ? item.images
    : item.image_public_url ? [{ storage_key: item.image_public_url, public_url: item.image_public_url, is_primary: true }] : []
  );
  const [uploadingImg, setUploadingImg] = useState(false);

  async function handleAddImages(files: FileList | null) {
    if (!files || !workspace?.id) return;
    setUploadingImg(true);
    for (const file of Array.from(files)) {
      try {
        const urlRes = await fetch("/api/media/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, mime_type: file.type }) });
        if (!urlRes.ok) continue;
        const { signedUrl, key, publicUrl } = await urlRes.json();
        await fetch(signedUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        setItemImages((p) => [...p, { storage_key: key, public_url: publicUrl, is_primary: false }]);
      } catch { /* skip */ }
    }
    setUploadingImg(false);
  }

  const [form, setForm] = useState({
    nome: item.nome || "", url_slug: item.url_slug || "", composicao: item.composicao || "",
    preco: item.preco != null ? String(item.preco) : "", preco_custo: item.preco_custo != null ? String(item.preco_custo) : "",
    peso: item.peso != null ? String(item.peso) : "", ncm: item.ncm || "",
    largura: item.largura != null ? String(item.largura) : "", altura: item.altura != null ? String(item.altura) : "",
    comprimento: item.comprimento != null ? String(item.comprimento) : "", departamento_id: item.departamento_id || "",
    descricao_ecommerce: item.descricao_ecommerce || "", descricao_complementar: item.descricao_complementar || "",
    descricao_detalhada: item.descricao_detalhada || "", keywords: item.keywords || "",
    metatag_description: item.metatag_description || "", titulo_pagina: item.titulo_pagina || "",
  });

  function handleSave() {
    const updates: Record<string, unknown> = {};
    const s = (v: string | null) => v || "";
    const n = (v: number | null) => v != null ? String(v) : "";
    if (form.nome !== s(item.nome)) updates.nome = form.nome;
    if (form.url_slug !== s(item.url_slug)) updates.url_slug = form.url_slug;
    if (form.composicao !== s(item.composicao)) updates.composicao = form.composicao;
    if (form.preco !== n(item.preco)) updates.preco = form.preco ? parseFloat(form.preco) : null;
    if (form.preco_custo !== n(item.preco_custo)) updates.preco_custo = form.preco_custo ? parseFloat(form.preco_custo) : null;
    if (form.peso !== n(item.peso)) updates.peso = form.peso ? parseFloat(form.peso) : null;
    if (form.ncm !== s(item.ncm)) updates.ncm = form.ncm || null;
    if (form.largura !== n(item.largura)) updates.largura = form.largura ? parseFloat(form.largura) : null;
    if (form.altura !== n(item.altura)) updates.altura = form.altura ? parseFloat(form.altura) : null;
    if (form.comprimento !== n(item.comprimento)) updates.comprimento = form.comprimento ? parseFloat(form.comprimento) : null;
    if (form.descricao_ecommerce !== s(item.descricao_ecommerce)) updates.descricao_ecommerce = form.descricao_ecommerce;
    if (form.descricao_complementar !== s(item.descricao_complementar)) updates.descricao_complementar = form.descricao_complementar;
    if (form.descricao_detalhada !== s(item.descricao_detalhada)) updates.descricao_detalhada = form.descricao_detalhada;
    if (form.keywords !== s(item.keywords)) updates.keywords = form.keywords;
    if (form.metatag_description !== s(item.metatag_description)) updates.metatag_description = form.metatag_description;
    if (form.titulo_pagina !== s(item.titulo_pagina)) updates.titulo_pagina = form.titulo_pagina;
    if (form.departamento_id !== s(item.departamento_id)) {
      updates.departamento_id = form.departamento_id || null;
      updates.departamento_nome = categories?.find((d) => String(d.id) === form.departamento_id)?.nome || null;
    }
    if (JSON.stringify(itemImages) !== JSON.stringify(item.images || [])) {
      updates.images = itemImages;
      if (itemImages.length > 0) { updates.image_public_url = itemImages[0].public_url; updates.image_storage_key = itemImages[0].storage_key; }
    }
    onSave(Object.keys(updates).length > 0 ? updates : { nome: form.nome });
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Editar Produto</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1.5">
              {itemImages.map((img, i) => (
                <div key={i} className="relative aspect-square rounded-md overflow-hidden border bg-muted group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.public_url} alt="" className="w-full h-full object-cover" />
                  {i === 0 && <span className="absolute top-0.5 left-0.5 bg-primary text-primary-foreground text-[9px] px-1 py-0.5 rounded">Principal</span>}
                  <button type="button" onClick={() => setItemImages((p) => p.filter((_, j) => j !== i))} className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"><X className="h-3 w-3" /></button>
                </div>
              ))}
              <button type="button" onClick={() => fileInputRef.current?.click()} className="aspect-square rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-1 hover:border-primary/50">
                {uploadingImg ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4 text-muted-foreground" />}
                <span className="text-[9px] text-muted-foreground">Adicionar</span>
              </button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => handleAddImages(e.target.files)} />
          </div>
          <div className="space-y-3">
            <div><Label className="text-xs">Nome</Label><Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} /></div>
            <div><Label className="text-xs">URL / Slug</Label><Input value={form.url_slug} onChange={(e) => setForm((f) => ({ ...f, url_slug: e.target.value }))} /></div>
            <div><Label className="text-xs">Composicao</Label><Input value={form.composicao} onChange={(e) => setForm((f) => ({ ...f, composicao: e.target.value }))} /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Preco</Label><Input type="number" step="0.01" value={form.preco} onChange={(e) => setForm((f) => ({ ...f, preco: e.target.value }))} /></div>
              <div><Label className="text-xs">Custo</Label><Input type="number" step="0.01" value={form.preco_custo} onChange={(e) => setForm((f) => ({ ...f, preco_custo: e.target.value }))} /></div>
              <div><Label className="text-xs">NCM</Label><Input value={form.ncm} onChange={(e) => setForm((f) => ({ ...f, ncm: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Peso (kg)</Label><Input type="number" step="0.001" value={form.peso} onChange={(e) => setForm((f) => ({ ...f, peso: e.target.value }))} /></div>
              <div><Label className="text-xs">C x L x A (cm)</Label><div className="flex gap-1"><Input type="number" placeholder="C" value={form.comprimento} onChange={(e) => setForm((f) => ({ ...f, comprimento: e.target.value }))} /><Input type="number" placeholder="L" value={form.largura} onChange={(e) => setForm((f) => ({ ...f, largura: e.target.value }))} /><Input type="number" placeholder="A" value={form.altura} onChange={(e) => setForm((f) => ({ ...f, altura: e.target.value }))} /></div></div>
            </div>
          </div>
        </div>
        {categories && categories.length > 0 && (
          <div className="mt-3"><Label className="text-xs">Categoria</Label>
            <Select value={form.departamento_id} onValueChange={(v) => setForm((f) => ({ ...f, departamento_id: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{categories.map((d) => (<SelectItem key={String(d.id)} value={String(d.id)}>{d.nome}</SelectItem>))}</SelectContent></Select>
          </div>
        )}
        <div className="space-y-3 mt-3">
          <div><Label className="text-xs">Descricao Complementar</Label><Textarea rows={2} value={form.descricao_complementar} onChange={(e) => setForm((f) => ({ ...f, descricao_complementar: e.target.value }))} /></div>
          <div><Label className="text-xs">Descricao E-commerce</Label><Textarea rows={3} value={form.descricao_ecommerce} onChange={(e) => setForm((f) => ({ ...f, descricao_ecommerce: e.target.value }))} /></div>
          <div><Label className="text-xs">Descricao Detalhada</Label><Textarea rows={3} value={form.descricao_detalhada} onChange={(e) => setForm((f) => ({ ...f, descricao_detalhada: e.target.value }))} /></div>
        </div>
        <div className="space-y-3 mt-3">
          <div><Label className="text-xs">Titulo SEO</Label><Input value={form.titulo_pagina} onChange={(e) => setForm((f) => ({ ...f, titulo_pagina: e.target.value }))} /></div>
          <div><Label className="text-xs">Keywords</Label><Textarea rows={2} value={form.keywords} onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))} /></div>
          <div><Label className="text-xs">Metatag</Label><Textarea rows={2} value={form.metatag_description} onChange={(e) => setForm((f) => ({ ...f, metatag_description: e.target.value }))} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave}><Check className="mr-2 h-4 w-4" />Salvar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

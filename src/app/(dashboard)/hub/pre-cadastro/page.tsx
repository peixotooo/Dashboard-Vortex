"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Plus,
  Package,
  Loader2,
  Trash2,
  ImagePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useWorkspace } from "@/lib/workspace-context";
import { CollectionFormDialog } from "@/components/pre-cadastro/collection-form";

interface Collection {
  id: string;
  name: string;
  context_description: string | null;
  status: string;
  total_items: number;
  submitted_items: number;
  items_pending: number;
  items_ready: number;
  items_submitted: number;
  items_error: number;
  created_at: string;
}

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Rascunho", variant: "secondary" },
  processing: { label: "Processando", variant: "default" },
  review: { label: "Em Revisao", variant: "outline" },
  submitted: { label: "Enviado", variant: "default" },
};

export default function PreCadastroPage() {
  const { workspace } = useWorkspace();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const fetchCollections = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const res = await fetch("/api/pre-cadastro/collections", {
        headers: { "x-workspace-id": workspace.id },
      });
      if (res.ok) {
        setCollections(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  async function handleDelete(id: string) {
    if (!workspace?.id || !confirm("Excluir esta colecao e todos os itens?")) return;
    await fetch(`/api/pre-cadastro/collections/${id}`, {
      method: "DELETE",
      headers: { "x-workspace-id": workspace.id },
    });
    fetchCollections();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pre-Cadastro de Produtos</h1>
          <p className="text-sm text-muted-foreground">
            Cadastre produtos no Eccosys a partir de fotos com auxilio de IA
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nova Colecao
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : collections.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <ImagePlus className="h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">Nenhuma colecao criada ainda</p>
            <Button onClick={() => setShowForm(true)} variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Criar Colecao
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {collections.map((c) => {
            const progress = c.total_items > 0 ? Math.round((c.items_submitted / c.total_items) * 100) : 0;
            const statusInfo = STATUS_LABELS[c.status] || STATUS_LABELS.draft;

            return (
              <Link key={c.id} href={`/hub/pre-cadastro/${c.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        <h3 className="font-semibold text-sm">{c.name}</h3>
                      </div>
                      <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                    </div>

                    {c.context_description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {c.context_description}
                      </p>
                    )}

                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{c.total_items} produtos</span>
                        <span>{c.items_submitted} enviados</span>
                      </div>
                      <Progress value={progress} className="h-1.5" />
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex gap-2">
                        {c.items_pending > 0 && <span>{c.items_pending} pendentes</span>}
                        {c.items_ready > 0 && <span className="text-green-600">{c.items_ready} prontos</span>}
                        {c.items_error > 0 && <span className="text-red-600">{c.items_error} erros</span>}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDelete(c.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <CollectionFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        onCreated={fetchCollections}
      />
    </div>
  );
}

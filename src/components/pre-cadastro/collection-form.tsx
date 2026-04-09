"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/lib/workspace-context";

interface TemplateProduct {
  id: number;
  nome: string;
  codigo: string;
  cf: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CollectionFormDialog({ open, onOpenChange, onCreated }: Props) {
  const { workspace } = useWorkspace();
  const [name, setName] = useState("");
  const [contextDescription, setContextDescription] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateResults, setTemplateResults] = useState<TemplateProduct[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateProduct | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function searchTemplates() {
    if (!workspace?.id || !templateSearch.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(
        `/api/pre-cadastro/template-products?search=${encodeURIComponent(templateSearch)}`,
        { headers: { "x-workspace-id": workspace.id } }
      );
      if (res.ok) {
        setTemplateResults(await res.json());
      }
    } finally {
      setSearching(false);
    }
  }

  async function handleSubmit() {
    if (!workspace?.id || !name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/pre-cadastro/collections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspace.id,
        },
        body: JSON.stringify({
          name: name.trim(),
          context_description: contextDescription.trim() || null,
          template_ecc_id: selectedTemplate?.id || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Erro ao criar colecao");
        return;
      }

      // Reset and close
      setName("");
      setContextDescription("");
      setSelectedTemplate(null);
      setTemplateSearch("");
      setTemplateResults([]);
      onOpenChange(false);
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova Colecao</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Nome da Colecao</Label>
            <Input
              id="name"
              placeholder="Ex: Colecao Primavera 2025"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="context">Contexto / Descricao</Label>
            <Textarea
              id="context"
              placeholder="Ex: Vestidos florais leves, linha feminina casual, publico 25-40 anos"
              value={contextDescription}
              onChange={(e) => setContextDescription(e.target.value)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground mt-1">
              A IA usa esse contexto para gerar nomes e descricoes coerentes
            </p>
          </div>

          <div>
            <Label>Produto Template (opcional)</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Herda NCM, fornecedor, unidade e outros campos fiscais
            </p>

            {selectedTemplate ? (
              <div className="flex items-center justify-between p-3 rounded-md border bg-muted/30">
                <div>
                  <p className="text-sm font-medium">{selectedTemplate.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedTemplate.codigo} | NCM: {selectedTemplate.cf || "N/A"}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedTemplate(null)}>
                  Remover
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="Buscar por nome ou codigo..."
                    value={templateSearch}
                    onChange={(e) => setTemplateSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && searchTemplates()}
                  />
                  <Button variant="outline" size="icon" onClick={searchTemplates} disabled={searching}>
                    {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>

                {templateResults.length > 0 && (
                  <div className="border rounded-md max-h-40 overflow-y-auto">
                    {templateResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-muted text-sm border-b last:border-b-0"
                        onClick={() => {
                          setSelectedTemplate(p);
                          setTemplateResults([]);
                        }}
                      >
                        <span className="font-medium">{p.nome}</span>
                        <span className="text-muted-foreground ml-2">({p.codigo})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={saving || !name.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar Colecao
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

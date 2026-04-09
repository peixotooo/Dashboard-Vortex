"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/lib/workspace-context";

const DEFAULT_GRADE = ["P", "M", "G", "GG", "XGG"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CollectionFormDialog({ open, onOpenChange, onCreated }: Props) {
  const { workspace } = useWorkspace();
  const [name, setName] = useState("");
  const [contextDescription, setContextDescription] = useState("");
  const [grade, setGrade] = useState<string[]>(DEFAULT_GRADE);
  const [newSize, setNewSize] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function addSize() {
    const size = newSize.trim().toUpperCase();
    if (size && !grade.includes(size)) {
      setGrade([...grade, size]);
      setNewSize("");
    }
  }

  function removeSize(size: string) {
    setGrade(grade.filter((s) => s !== size));
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
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Erro ao criar colecao");
        return;
      }

      setName("");
      setContextDescription("");
      setGrade(DEFAULT_GRADE);
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
            <Label>Grade de Tamanhos</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Cada produto criara variacoes (SKUs filhos) com estes tamanhos
            </p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {grade.map((size) => (
                <Badge key={size} variant="secondary" className="gap-1 pr-1">
                  {size}
                  <button
                    type="button"
                    onClick={() => removeSize(size)}
                    className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Adicionar tamanho..."
                value={newSize}
                onChange={(e) => setNewSize(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSize())}
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={addSize} disabled={!newSize.trim()}>
                Adicionar
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground bg-muted/50 rounded-md p-3">
            Campos fiscais (NCM, fornecedor, unidade) herdados automaticamente de produtos existentes no Eccosys.
            EAN-14 gerado automaticamente para cada SKU filho.
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={saving || !name.trim() || grade.length === 0}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar Colecao
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

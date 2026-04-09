"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CollectionFormDialog({ open, onOpenChange, onCreated }: Props) {
  const { workspace } = useWorkspace();
  const [name, setName] = useState("");
  const [contextDescription, setContextDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

      // Reset and close
      setName("");
      setContextDescription("");
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

          <p className="text-xs text-muted-foreground bg-muted/50 rounded-md p-3">
            Os campos fiscais (NCM, fornecedor, unidade) serao herdados automaticamente
            de produtos existentes no Eccosys com base na categoria detectada pela IA.
          </p>

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

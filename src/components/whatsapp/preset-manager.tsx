"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Play, Pencil } from "lucide-react";

export interface Preset {
  id: string;
  name: string;
  group_jids: string[];
  created_at: string;
}

interface PresetManagerProps {
  presets: Preset[];
  selectedGroups: Set<string>;
  onApplyPreset: (jids: string[]) => void;
  onPresetsChange: () => void;
  workspaceId: string;
}

export function PresetManager({
  presets,
  selectedGroups,
  onApplyPreset,
  onPresetsChange,
  workspaceId,
}: PresetManagerProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editPreset, setEditPreset] = useState<Preset | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim() || selectedGroups.size === 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/whatsapp-groups/presets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          name: name.trim(),
          group_jids: Array.from(selectedGroups),
        }),
      });
      if (res.ok) {
        setCreateOpen(false);
        setName("");
        onPresetsChange();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editPreset || !name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/whatsapp-groups/presets/${editPreset.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-workspace-id": workspaceId,
          },
          body: JSON.stringify({
            name: name.trim(),
            group_jids: Array.from(selectedGroups),
          }),
        }
      );
      if (res.ok) {
        setEditPreset(null);
        setName("");
        onPresetsChange();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/whatsapp-groups/presets/${id}`, {
        method: "DELETE",
        headers: { "x-workspace-id": workspaceId },
      });
      if (res.ok) onPresetsChange();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Presets de Grupos</h4>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={selectedGroups.size === 0}
          onClick={() => {
            setName("");
            setCreateOpen(true);
          }}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Salvar selecao
        </Button>
      </div>

      {presets.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum preset criado. Selecione grupos e salve como preset.
        </p>
      ) : (
        <div className="space-y-1.5">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium truncate">
                  {preset.name}
                </span>
                <Badge variant="secondary" className="text-xs shrink-0">
                  {preset.group_jids.length} grupos
                </Badge>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Aplicar preset"
                  onClick={() => onApplyPreset(preset.group_jids)}
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Editar preset"
                  onClick={() => {
                    setEditPreset(preset);
                    setName(preset.name);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  title="Excluir preset"
                  disabled={deletingId === preset.id}
                  onClick={() => handleDelete(preset.id)}
                >
                  {deletingId === preset.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Salvar Preset</DialogTitle>
            <DialogDescription>
              Salvar {selectedGroups.size} grupo(s) selecionado(s) como preset
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Nome do preset..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={!name.trim() || saving}
                onClick={handleCreate}
              >
                {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={!!editPreset}
        onOpenChange={(open) => !open && setEditPreset(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Preset</DialogTitle>
            <DialogDescription>
              Atualizar nome e grupos do preset (usa a selecao atual)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Nome do preset..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditPreset(null)}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={!name.trim() || saving}
                onClick={handleUpdate}
              >
                {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Atualizar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

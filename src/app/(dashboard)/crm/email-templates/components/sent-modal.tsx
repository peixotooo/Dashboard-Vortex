"use client";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EmailSuggestion } from "@/lib/email-templates/types";

function nowLocalIso(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function SentModal({
  open,
  onClose,
  suggestion,
  workspaceId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  suggestion: EmailSuggestion;
  workspaceId: string;
  onDone: () => void;
}) {
  const [sentAt, setSentAt] = useState(nowLocalIso());
  const [hour, setHour] = useState<string>("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/crm/email-templates/${suggestion.id}/sent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-workspace-id": workspaceId },
        body: JSON.stringify({
          sent_at: new Date(sentAt).toISOString(),
          hour_chosen: hour ? parseInt(hour, 10) : null,
        }),
      });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar como disparado</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sent_at">Data e hora do disparo</Label>
            <Input
              id="sent_at"
              type="datetime-local"
              value={sentAt}
              onChange={(e) => setSentAt(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Qual horário sugerido você usou? (opcional)</Label>
            <Select value={hour} onValueChange={setHour}>
              <SelectTrigger>
                <SelectValue placeholder="Outro / não informar" />
              </SelectTrigger>
              <SelectContent>
                {suggestion.recommended_hours.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {String(h).padStart(2, "0")}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

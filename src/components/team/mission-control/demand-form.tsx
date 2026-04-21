"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AREAS,
  CHANNELS,
  DEMAND_STATUSES,
  HEALTHS,
  PRIORITIES,
} from "@/lib/team/mission-control/types";
import { AREA_LABEL, STATUS_LABEL, HEALTH_LABEL } from "@/lib/team/mission-control/format";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
}

// New-demand form. Captures only the fields needed at triage time — heavier
// fields (blockers, impact, next action) live on the detail page after triage.
export function DemandForm({ open, onOpenChange, onSubmit }: Props) {
  const [state, setState] = useState<Record<string, string | boolean | number>>({
    title: "",
    description: "",
    area: "ops",
    channel: "",
    status: "new",
    priority: "medium",
    health: "on_track",
    owner: "",
    requester: "",
    objective: "",
    expected_outcome: "",
    reply_sla_hours: 3,
  });
  const [saving, setSaving] = useState(false);

  const setField = (k: string, v: string | boolean | number) =>
    setState((prev) => ({ ...prev, [k]: v }));

  const submit = async () => {
    if (!state.title) return;
    setSaving(true);
    try {
      const payload = { ...state };
      if (!payload.channel) delete payload.channel;
      await onSubmit(payload);
      onOpenChange(false);
      setState({
        title: "",
        description: "",
        area: "ops",
        channel: "",
        status: "new",
        priority: "medium",
        health: "on_track",
        owner: "",
        requester: "",
        objective: "",
        expected_outcome: "",
        reply_sla_hours: 3,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova Demanda</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Titulo *</Label>
            <Input
              value={state.title as string}
              onChange={(e) => setField("title", e.target.value)}
              placeholder="Ex: Criativo novo Meta Ads nao performou"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Descricao</Label>
            <Textarea
              value={state.description as string}
              onChange={(e) => setField("description", e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Area</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={state.area as string}
                onChange={(e) => setField("area", e.target.value)}
              >
                {AREAS.map((a) => (
                  <option key={a} value={a}>
                    {AREA_LABEL[a]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>Canal</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={state.channel as string}
                onChange={(e) => setField("channel", e.target.value)}
              >
                <option value="">-</option>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={state.status as string}
                onChange={(e) => setField("status", e.target.value)}
              >
                {DEMAND_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>Prioridade</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={state.priority as string}
                onChange={(e) => setField("priority", e.target.value)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>Saude</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={state.health as string}
                onChange={(e) => setField("health", e.target.value)}
              >
                {HEALTHS.map((h) => (
                  <option key={h} value={h}>
                    {HEALTH_LABEL[h]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>SLA resposta (h)</Label>
              <Input
                type="number"
                value={state.reply_sla_hours as number}
                onChange={(e) => setField("reply_sla_hours", Number(e.target.value))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Owner</Label>
              <Input
                value={state.owner as string}
                onChange={(e) => setField("owner", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Requester</Label>
              <Input
                value={state.requester as string}
                onChange={(e) => setField("requester", e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Objetivo</Label>
            <Input
              value={state.objective as string}
              onChange={(e) => setField("objective", e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Resultado esperado</Label>
            <Input
              value={state.expected_outcome as string}
              onChange={(e) => setField("expected_outcome", e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving || !state.title}>
            {saving ? "Salvando..." : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

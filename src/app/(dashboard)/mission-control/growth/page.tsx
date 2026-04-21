"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FlaskConical, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { useWorkspace } from "@/lib/workspace-context";
import type { Experiment } from "@/lib/mission-control/types";
import { AREAS, EXPERIMENT_STATUSES, PRIORITIES } from "@/lib/mission-control/types";
import { AREA_LABEL, formatShortDateTime } from "@/lib/mission-control/format";

const COLUMNS: Array<{ key: Experiment["status"]; label: string; color: string }> = [
  { key: "backlog", label: "Backlog", color: "bg-gray-500" },
  { key: "approved", label: "Aprovado", color: "bg-blue-500" },
  { key: "running", label: "Rodando", color: "bg-indigo-500" },
  { key: "analyzing", label: "Analisando", color: "bg-amber-500" },
  { key: "won", label: "Vencedor", color: "bg-emerald-500" },
  { key: "lost", label: "Perdedor", color: "bg-red-500" },
  { key: "inconclusive", label: "Inconclusivo", color: "bg-slate-500" },
  { key: "paused", label: "Pausado", color: "bg-orange-500" },
];

// Growth Board — kanban of experiments. Click a card to edit it in-place.
export default function GrowthBoardPage() {
  const { workspace } = useWorkspace();
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Experiment> | null>(null);

  const load = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const res = await fetch("/api/mission-control/experiments", {
        headers: { "x-workspace-id": workspace.id },
      });
      if (res.ok) {
        const data = await res.json();
        setExperiments(data.experiments);
      }
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!workspace?.id || !editing) return;
    const method = editing.id ? "PUT" : "POST";
    const path = editing.id
      ? `/api/mission-control/experiments/${editing.id}`
      : "/api/mission-control/experiments";
    await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-workspace-id": workspace.id,
      },
      body: JSON.stringify(editing),
    });
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!workspace?.id) return;
    if (!confirm("Excluir experimento?")) return;
    await fetch(`/api/mission-control/experiments/${id}`, {
      method: "DELETE",
      headers: { "x-workspace-id": workspace.id },
    });
    load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/mission-control"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-3 w-3" /> Mission Control
          </Link>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2 mt-1">
            <FlaskConical className="h-7 w-7" />
            Growth Board
          </h1>
          <p className="text-muted-foreground mt-1">
            Experimentos em andamento e hipoteses testadas.
          </p>
        </div>
        <Button onClick={() => setEditing({ status: "backlog", area: "acquisition", priority: "medium" })}>
          <Plus className="h-4 w-4 mr-2" />
          Novo Experimento
        </Button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const items = experiments.filter((e) => e.status === col.key);
          return (
            <div key={col.key} className="flex-1 min-w-[240px] max-w-[300px]">
              <div className="flex items-center gap-2 mb-2">
                <span className={`h-2.5 w-2.5 rounded-full ${col.color}`} />
                <h3 className="text-sm font-semibold">{col.label}</h3>
                <Badge variant="secondary" className="text-xs ml-auto">
                  {items.length}
                </Badge>
              </div>
              <div className="space-y-2">
                {items.map((e) => (
                  <Card
                    key={e.id}
                    className="cursor-pointer hover:border-primary/40"
                    onClick={() => setEditing(e)}
                  >
                    <CardContent className="p-3 space-y-1.5">
                      <h4 className="text-sm font-medium line-clamp-2">{e.title}</h4>
                      {e.hypothesis && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {e.hypothesis}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-[10px]">
                          {AREA_LABEL[e.area]}
                        </Badge>
                        {e.priority && (
                          <Badge variant="secondary" className="text-[10px]">
                            {e.priority}
                          </Badge>
                        )}
                      </div>
                      {e.target_metric && (
                        <div className="text-[11px] text-muted-foreground">
                          <span className="font-medium">Meta:</span> {e.target_metric}
                        </div>
                      )}
                      {e.owner && (
                        <div className="text-[11px] text-muted-foreground">
                          {e.owner}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "Editar Experimento" : "Novo Experimento"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <F label="Titulo">
                <Input
                  value={editing.title ?? ""}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </F>
              <F label="Hipotese">
                <Textarea
                  rows={3}
                  value={editing.hypothesis ?? ""}
                  onChange={(e) => setEditing({ ...editing, hypothesis: e.target.value })}
                />
              </F>
              <div className="grid grid-cols-2 gap-3">
                <F label="Area">
                  <select
                    value={editing.area ?? "acquisition"}
                    onChange={(e) =>
                      setEditing({ ...editing, area: e.target.value as Experiment["area"] })
                    }
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {AREAS.map((a) => (
                      <option key={a} value={a}>
                        {AREA_LABEL[a]}
                      </option>
                    ))}
                  </select>
                </F>
                <F label="Status">
                  <select
                    value={editing.status ?? "backlog"}
                    onChange={(e) =>
                      setEditing({ ...editing, status: e.target.value as Experiment["status"] })
                    }
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {EXPERIMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </F>
                <F label="Prioridade">
                  <select
                    value={editing.priority ?? "medium"}
                    onChange={(e) =>
                      setEditing({ ...editing, priority: e.target.value as Experiment["priority"] })
                    }
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </F>
                <F label="Owner">
                  <Input
                    value={editing.owner ?? ""}
                    onChange={(e) => setEditing({ ...editing, owner: e.target.value })}
                  />
                </F>
                <F label="Baseline">
                  <Input
                    value={editing.baseline_metric ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, baseline_metric: e.target.value })
                    }
                  />
                </F>
                <F label="Meta">
                  <Input
                    value={editing.target_metric ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, target_metric: e.target.value })
                    }
                  />
                </F>
                <F label="Atual">
                  <Input
                    value={editing.current_metric ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, current_metric: e.target.value })
                    }
                  />
                </F>
                <F label="Confianca">
                  <Input
                    value={editing.confidence ?? ""}
                    onChange={(e) => setEditing({ ...editing, confidence: e.target.value })}
                  />
                </F>
              </div>
              <F label="Impacto esperado">
                <Input
                  value={editing.expected_impact ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, expected_impact: e.target.value })
                  }
                />
              </F>
              <F label="Impacto real">
                <Input
                  value={editing.actual_impact ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, actual_impact: e.target.value })
                  }
                />
              </F>
              <F label="Decisao">
                <Textarea
                  rows={2}
                  value={editing.decision ?? ""}
                  onChange={(e) => setEditing({ ...editing, decision: e.target.value })}
                />
              </F>
              <F label="Proximo passo">
                <Input
                  value={editing.next_step ?? ""}
                  onChange={(e) => setEditing({ ...editing, next_step: e.target.value })}
                />
              </F>
              <F label="Resumo do aprendizado">
                <Textarea
                  rows={2}
                  value={editing.learning_summary ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, learning_summary: e.target.value })
                  }
                />
              </F>
              {editing.updated_at && (
                <p className="text-xs text-muted-foreground">
                  Ultimo update: {formatShortDateTime(editing.updated_at)}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            {editing?.id && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  remove(editing.id!);
                  setEditing(null);
                }}
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={!editing?.title}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

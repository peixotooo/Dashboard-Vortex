"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, TrendingUp } from "lucide-react";
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
import type { ExecutiveReport } from "@/lib/team/mission-control/types";
import { formatShortDateTime } from "@/lib/team/mission-control/format";

export default function ReportsPage() {
  const { workspace } = useWorkspace();
  const [reports, setReports] = useState<ExecutiveReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<ExecutiveReport> | null>(null);

  const load = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const res = await fetch("/api/team/mission-control/reports", {
        headers: { "x-workspace-id": workspace.id },
      });
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports);
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
      ? `/api/team/mission-control/reports/${editing.id}`
      : "/api/team/mission-control/reports";
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

  const markSent = async (r: ExecutiveReport) => {
    if (!workspace?.id) return;
    await fetch(`/api/team/mission-control/reports/${r.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-id": workspace.id,
      },
      body: JSON.stringify({ sent: true, sent_at_utc: new Date().toISOString() }),
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
            href="/team/mission-control"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-3 w-3" /> Mission Control
          </Link>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2 mt-1">
            <TrendingUp className="h-7 w-7" />
            Executive Reports
          </h1>
          <p className="text-muted-foreground mt-1">
            Resumos operacionais para lideranca.
          </p>
        </div>
        <Button
          onClick={() =>
            setEditing({
              period_type: "weekly",
              period_label: new Date().toLocaleDateString("pt-BR"),
              audience: "diretoria",
            })
          }
        >
          <Plus className="h-4 w-4 mr-2" />
          Novo Report
        </Button>
      </div>

      <div className="grid gap-3">
        {reports.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center text-muted-foreground text-sm">
              Nenhum report gerado.
            </CardContent>
          </Card>
        ) : (
          reports.map((r) => (
            <Card
              key={r.id}
              className="cursor-pointer hover:border-primary/30"
              onClick={() => setEditing(r)}
            >
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{r.period_label}</h3>
                      <Badge variant="outline" className="text-[10px]">
                        {r.period_type}
                      </Badge>
                      {r.sent ? (
                        <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">
                          enviado
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">
                          rascunho
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Publico: {r.audience ?? "-"} · Gerado {formatShortDateTime(r.generated_at_utc)}
                    </p>
                  </div>
                  {!r.sent && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        markSent(r);
                      }}
                    >
                      Marcar enviado
                    </Button>
                  )}
                </div>
                {r.summary && (
                  <p className="text-sm line-clamp-3 text-muted-foreground">
                    {r.summary}
                  </p>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "Editar Report" : "Novo Report"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div className="grid grid-cols-3 gap-3">
                <F label="Tipo">
                  <select
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={editing.period_type ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, period_type: e.target.value })
                    }
                  >
                    <option value="">-</option>
                    <option value="daily">Diario</option>
                    <option value="weekly">Semanal</option>
                    <option value="monthly">Mensal</option>
                    <option value="quarterly">Trimestral</option>
                    <option value="ad_hoc">Ad hoc</option>
                  </select>
                </F>
                <F label="Label">
                  <Input
                    value={editing.period_label ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, period_label: e.target.value })
                    }
                  />
                </F>
                <F label="Publico">
                  <Input
                    value={editing.audience ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, audience: e.target.value })
                    }
                  />
                </F>
              </div>

              <F label="Resumo">
                <Textarea
                  rows={4}
                  value={editing.summary ?? ""}
                  onChange={(e) => setEditing({ ...editing, summary: e.target.value })}
                />
              </F>
              <F label="O que melhorou">
                <Textarea
                  rows={3}
                  value={editing.what_improved ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, what_improved: e.target.value })
                  }
                />
              </F>
              <F label="O que piorou">
                <Textarea
                  rows={3}
                  value={editing.what_worsened ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, what_worsened: e.target.value })
                  }
                />
              </F>
              <F label="Bloqueios">
                <Textarea
                  rows={3}
                  value={editing.blockers ?? ""}
                  onChange={(e) => setEditing({ ...editing, blockers: e.target.value })}
                />
              </F>
              <F label="Proximas acoes">
                <Textarea
                  rows={3}
                  value={editing.next_actions ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, next_actions: e.target.value })
                  }
                />
              </F>
              <F label="Decisoes necessarias">
                <Textarea
                  rows={3}
                  value={editing.decisions_needed ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, decisions_needed: e.target.value })
                  }
                />
              </F>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={save}>Salvar</Button>
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

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, CheckCircle2, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/lib/workspace-context";
import type { Decision, Learning } from "@/lib/team/mission-control/types";
import { formatShortDateTime } from "@/lib/team/mission-control/format";

export default function LearningsDecisionsPage() {
  const { workspace } = useWorkspace();
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingLearning, setEditingLearning] = useState<Partial<Learning> | null>(
    null
  );
  const [editingDecision, setEditingDecision] = useState<Partial<Decision> | null>(
    null
  );

  const load = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const [lRes, dRes] = await Promise.all([
        fetch("/api/team/mission-control/learnings", {
          headers: { "x-workspace-id": workspace.id },
        }),
        fetch("/api/team/mission-control/decisions", {
          headers: { "x-workspace-id": workspace.id },
        }),
      ]);
      if (lRes.ok) {
        const data = await lRes.json();
        setLearnings(data.learnings);
      }
      if (dRes.ok) {
        const data = await dRes.json();
        setDecisions(data.decisions);
      }
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const saveLearning = async () => {
    if (!workspace?.id || !editingLearning) return;
    const method = editingLearning.id ? "PUT" : "POST";
    const path = editingLearning.id
      ? `/api/team/mission-control/learnings/${editingLearning.id}`
      : "/api/team/mission-control/learnings";
    await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-workspace-id": workspace.id,
      },
      body: JSON.stringify(editingLearning),
    });
    setEditingLearning(null);
    load();
  };

  const saveDecision = async () => {
    if (!workspace?.id || !editingDecision) return;
    const method = editingDecision.id ? "PUT" : "POST";
    const path = editingDecision.id
      ? `/api/team/mission-control/decisions/${editingDecision.id}`
      : "/api/team/mission-control/decisions";
    await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-workspace-id": workspace.id,
      },
      body: JSON.stringify(editingDecision),
    });
    setEditingDecision(null);
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
      <div>
        <Link
          href="/team/mission-control"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" /> Mission Control
        </Link>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2 mt-1">
          <BookOpen className="h-7 w-7" />
          Learnings & Decisions
        </h1>
        <p className="text-muted-foreground mt-1">
          Conhecimento reutilizavel e decisoes registradas.
        </p>
      </div>

      <Tabs defaultValue="learnings">
        <TabsList>
          <TabsTrigger value="learnings">Learnings</TabsTrigger>
          <TabsTrigger value="decisions">Decisions</TabsTrigger>
        </TabsList>

        <TabsContent value="learnings" className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setEditingLearning({ reusable: true })}>
              <Plus className="h-4 w-4 mr-1" /> Novo Learning
            </Button>
          </div>
          <div className="grid gap-3">
            {learnings.length === 0 ? (
              <Card>
                <CardContent className="p-10 text-center text-muted-foreground text-sm">
                  Nenhum aprendizado registrado.
                </CardContent>
              </Card>
            ) : (
              learnings.map((l) => (
                <Card
                  key={l.id}
                  className="cursor-pointer hover:border-primary/30"
                  onClick={() => setEditingLearning(l)}
                >
                  <CardContent className="p-4 space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">{l.title}</h3>
                      {l.area && (
                        <Badge variant="outline" className="text-[10px]">
                          {l.area}
                        </Badge>
                      )}
                      {l.reusable && (
                        <Badge className="bg-emerald-100 text-emerald-700 text-[10px] gap-1">
                          <CheckCircle2 className="h-3 w-3" /> reutilizavel
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-3">
                      {l.learning}
                    </p>
                    <div className="text-[11px] text-muted-foreground">
                      {formatShortDateTime(l.date_utc)} {l.source && `· ${l.source}`}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="decisions" className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setEditingDecision({ still_valid: true })}>
              <Plus className="h-4 w-4 mr-1" /> Nova Decisao
            </Button>
          </div>
          <div className="grid gap-3">
            {decisions.length === 0 ? (
              <Card>
                <CardContent className="p-10 text-center text-muted-foreground text-sm">
                  Nenhuma decisao registrada.
                </CardContent>
              </Card>
            ) : (
              decisions.map((d) => (
                <Card
                  key={d.id}
                  className="cursor-pointer hover:border-primary/30"
                  onClick={() => setEditingDecision(d)}
                >
                  <CardContent className="p-4 space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">{d.title}</h3>
                      {d.impact_level && (
                        <Badge variant="outline" className="text-[10px]">
                          {d.impact_level}
                        </Badge>
                      )}
                      {d.still_valid ? (
                        <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">
                          valida
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">
                          expirada
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-3">
                      {d.decision}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatShortDateTime(d.decision_date_utc)}{" "}
                      {d.decided_by && `· por ${d.decided_by}`}
                    </p>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!editingLearning}
        onOpenChange={(v) => !v && setEditingLearning(null)}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingLearning?.id ? "Editar Learning" : "Novo Learning"}
            </DialogTitle>
          </DialogHeader>
          {editingLearning && (
            <div className="grid gap-3">
              <F label="Titulo">
                <Input
                  value={editingLearning.title ?? ""}
                  onChange={(e) =>
                    setEditingLearning({ ...editingLearning, title: e.target.value })
                  }
                />
              </F>
              <F label="Aprendizado">
                <Textarea
                  rows={4}
                  value={editingLearning.learning ?? ""}
                  onChange={(e) =>
                    setEditingLearning({ ...editingLearning, learning: e.target.value })
                  }
                />
              </F>
              <div className="grid grid-cols-2 gap-3">
                <F label="Area">
                  <Input
                    value={editingLearning.area ?? ""}
                    onChange={(e) =>
                      setEditingLearning({ ...editingLearning, area: e.target.value })
                    }
                  />
                </F>
                <F label="Canal">
                  <Input
                    value={editingLearning.channel ?? ""}
                    onChange={(e) =>
                      setEditingLearning({ ...editingLearning, channel: e.target.value })
                    }
                  />
                </F>
                <F label="Tipo">
                  <Input
                    value={editingLearning.type ?? ""}
                    onChange={(e) =>
                      setEditingLearning({ ...editingLearning, type: e.target.value })
                    }
                  />
                </F>
                <F label="Fonte">
                  <Input
                    value={editingLearning.source ?? ""}
                    onChange={(e) =>
                      setEditingLearning({ ...editingLearning, source: e.target.value })
                    }
                  />
                </F>
                <F label="Confianca">
                  <Input
                    value={editingLearning.confidence ?? ""}
                    onChange={(e) =>
                      setEditingLearning({ ...editingLearning, confidence: e.target.value })
                    }
                  />
                </F>
                <F label="Reutilizavel">
                  <select
                    value={editingLearning.reusable ? "true" : "false"}
                    onChange={(e) =>
                      setEditingLearning({
                        ...editingLearning,
                        reusable: e.target.value === "true",
                      })
                    }
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="true">Sim</option>
                    <option value="false">Nao</option>
                  </select>
                </F>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingLearning(null)}>
              Cancelar
            </Button>
            <Button onClick={saveLearning} disabled={!editingLearning?.title}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editingDecision}
        onOpenChange={(v) => !v && setEditingDecision(null)}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingDecision?.id ? "Editar Decisao" : "Nova Decisao"}
            </DialogTitle>
          </DialogHeader>
          {editingDecision && (
            <div className="grid gap-3">
              <F label="Titulo">
                <Input
                  value={editingDecision.title ?? ""}
                  onChange={(e) =>
                    setEditingDecision({ ...editingDecision, title: e.target.value })
                  }
                />
              </F>
              <F label="Decisao">
                <Textarea
                  rows={3}
                  value={editingDecision.decision ?? ""}
                  onChange={(e) =>
                    setEditingDecision({ ...editingDecision, decision: e.target.value })
                  }
                />
              </F>
              <F label="Por que">
                <Textarea
                  rows={3}
                  value={editingDecision.why ?? ""}
                  onChange={(e) =>
                    setEditingDecision({ ...editingDecision, why: e.target.value })
                  }
                />
              </F>
              <div className="grid grid-cols-2 gap-3">
                <F label="Decidido por">
                  <Input
                    value={editingDecision.decided_by ?? ""}
                    onChange={(e) =>
                      setEditingDecision({
                        ...editingDecision,
                        decided_by: e.target.value,
                      })
                    }
                  />
                </F>
                <F label="Area">
                  <Input
                    value={editingDecision.area ?? ""}
                    onChange={(e) =>
                      setEditingDecision({ ...editingDecision, area: e.target.value })
                    }
                  />
                </F>
                <F label="Impacto">
                  <select
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={editingDecision.impact_level ?? ""}
                    onChange={(e) =>
                      setEditingDecision({
                        ...editingDecision,
                        impact_level: (e.target.value || null) as Decision["impact_level"],
                      })
                    }
                  >
                    <option value="">-</option>
                    <option value="high">Alto</option>
                    <option value="medium">Medio</option>
                    <option value="low">Baixo</option>
                  </select>
                </F>
                <F label="Ainda valida">
                  <select
                    value={editingDecision.still_valid ? "true" : "false"}
                    onChange={(e) =>
                      setEditingDecision({
                        ...editingDecision,
                        still_valid: e.target.value === "true",
                      })
                    }
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="true">Sim</option>
                    <option value="false">Nao</option>
                  </select>
                </F>
              </div>
              <F label="Notas">
                <Textarea
                  rows={2}
                  value={editingDecision.notes ?? ""}
                  onChange={(e) =>
                    setEditingDecision({ ...editingDecision, notes: e.target.value })
                  }
                />
              </F>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingDecision(null)}>
              Cancelar
            </Button>
            <Button onClick={saveDecision} disabled={!editingDecision?.title}>
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

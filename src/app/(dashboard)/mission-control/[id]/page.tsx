"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  Loader2,
  MessageSquare,
  Save,
  Send,
  ShieldAlert,
  Target,
  Trash2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useWorkspace } from "@/lib/workspace-context";
import type {
  ActivityLogEntry,
  Demand,
  FollowUp,
} from "@/lib/mission-control/types";
import {
  AREAS,
  CHANNELS,
  DEMAND_STATUSES,
  HEALTHS,
  MESSAGE_TYPES,
  PRIORITIES,
  REPLY_STATUSES,
} from "@/lib/mission-control/types";
import {
  AREA_LABEL,
  HEALTH_COLOR,
  HEALTH_LABEL,
  PRIORITY_COLOR,
  STATUS_COLOR,
  STATUS_LABEL,
  formatDateTime,
  formatShortDateTime,
  hoursOverdue,
} from "@/lib/mission-control/format";
import { cn } from "@/lib/utils";

export default function DemandDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { workspace } = useWorkspace();
  const [demand, setDemand] = useState<Demand | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Partial<Demand>>({});
  const [newFollowUp, setNewFollowUp] = useState<{
    target_person: string;
    message_type: string;
    message_text: string;
  }>({
    target_person: "Pricila",
    message_type: "charge",
    message_text: "Pricila, você conseguiu verificar ou ficou alguma dúvida?",
  });

  const load = useCallback(async () => {
    if (!workspace?.id || !params?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/mission-control/demands/${params.id}`, {
        headers: { "x-workspace-id": workspace.id },
      });
      if (!res.ok) {
        setDemand(null);
        return;
      }
      const data = await res.json();
      setDemand(data.demand);
      setFollowUps(data.followUps);
      setActivity(data.activity);
      setDraft({});
    } finally {
      setLoading(false);
    }
  }, [workspace?.id, params?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const saveField = async (patch: Partial<Demand>) => {
    if (!workspace?.id || !demand) return;
    setSaving(true);
    try {
      await fetch(`/api/mission-control/demands/${demand.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspace.id,
        },
        body: JSON.stringify(patch),
      });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const commitDraft = async () => {
    if (Object.keys(draft).length === 0) return;
    await saveField(draft);
  };

  const sendFollowUp = async () => {
    if (!workspace?.id || !demand) return;
    const payload = {
      ...newFollowUp,
      demand_id: demand.id,
    };
    await fetch("/api/mission-control/follow-ups", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-id": workspace.id,
      },
      body: JSON.stringify(payload),
    });
    load();
  };

  const markReplied = async (
    id: string,
    status: "replied" | "clarified" | "no_reply" | "late_reply"
  ) => {
    if (!workspace?.id) return;
    await fetch(`/api/mission-control/follow-ups/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-id": workspace.id,
      },
      body: JSON.stringify({
        reply_status: status,
        replied_at_utc:
          status === "replied" || status === "clarified"
            ? new Date().toISOString()
            : null,
      }),
    });
    load();
  };

  const chargePricila = async () => {
    if (!workspace?.id || !demand) return;
    await fetch(`/api/mission-control/demands/${demand.id}/charge-pricila`, {
      method: "POST",
      headers: { "x-workspace-id": workspace.id },
    });
    load();
  };

  const deleteDemand = async () => {
    if (!workspace?.id || !demand) return;
    if (!confirm("Excluir esta demanda? Esta acao nao pode ser desfeita.")) return;
    await fetch(`/api/mission-control/demands/${demand.id}`, {
      method: "DELETE",
      headers: { "x-workspace-id": workspace.id },
    });
    router.push("/mission-control");
  };

  if (loading && !demand) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!demand) {
    return (
      <div className="text-center py-24 text-muted-foreground">
        Demanda nao encontrada.{" "}
        <Link href="/mission-control" className="underline">
          Voltar
        </Link>
      </div>
    );
  }

  const merged: Demand = { ...demand, ...draft } as Demand;
  const overdue =
    merged.is_waiting_on_pricila && merged.next_follow_up_at_utc
      ? hoursOverdue(merged.next_follow_up_at_utc)
      : 0;
  const dirty = Object.keys(draft).length > 0;
  const setField = <K extends keyof Demand>(k: K, v: Demand[K]) =>
    setDraft((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <Link
            href="/mission-control"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-3 w-3" />
            Mission Control
          </Link>
          <h1 className="text-2xl font-bold tracking-tight mt-1">
            {merged.title}
          </h1>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Badge variant="secondary" className="gap-1">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  STATUS_COLOR[merged.status]
                )}
              />
              {STATUS_LABEL[merged.status]}
            </Badge>
            <Badge className={PRIORITY_COLOR[merged.priority]}>
              {merged.priority}
            </Badge>
            <Badge className={HEALTH_COLOR[merged.health]}>
              {HEALTH_LABEL[merged.health]}
            </Badge>
            <Badge variant="outline">{AREA_LABEL[merged.area]}</Badge>
            {merged.channel && (
              <Badge variant="outline">{merged.channel}</Badge>
            )}
            {overdue >= 3 && (
              <Badge variant="destructive" className="gap-1">
                overdue_{overdue}h
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {merged.is_waiting_on_pricila && (
            <Button variant="outline" size="sm" onClick={chargePricila}>
              <Bell className="h-4 w-4 mr-1" />
              Cobrar Pricila
            </Button>
          )}
          <Button onClick={commitDraft} disabled={!dirty || saving}>
            <Save className="h-4 w-4 mr-1" />
            {saving ? "Salvando..." : "Salvar"}
          </Button>
          <Button variant="ghost" size="icon" onClick={deleteDemand}>
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Contexto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Descricao">
                <Textarea
                  rows={2}
                  value={(merged.description as string) ?? ""}
                  onChange={(e) => setField("description", e.target.value)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Objetivo">
                  <Input
                    value={(merged.objective as string) ?? ""}
                    onChange={(e) => setField("objective", e.target.value)}
                  />
                </Field>
                <Field label="Resultado esperado">
                  <Input
                    value={(merged.expected_outcome as string) ?? ""}
                    onChange={(e) => setField("expected_outcome", e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Situacao atual">
                <Textarea
                  rows={2}
                  value={(merged.current_situation as string) ?? ""}
                  onChange={(e) => setField("current_situation", e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="h-4 w-4" /> Proxima acao
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Acao">
                <Textarea
                  rows={2}
                  value={(merged.next_action as string) ?? ""}
                  onChange={(e) => setField("next_action", e.target.value)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Owner">
                  <Input
                    value={(merged.next_action_owner as string) ?? ""}
                    onChange={(e) => setField("next_action_owner", e.target.value)}
                  />
                </Field>
                <Field label="Prazo (UTC)">
                  <Input
                    type="datetime-local"
                    value={isoToLocalInput(merged.next_action_due_at_utc)}
                    onChange={(e) =>
                      setField(
                        "next_action_due_at_utc",
                        e.target.value ? new Date(e.target.value).toISOString() : null
                      )
                    }
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldAlert className="h-4 w-4" /> Bloqueio
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Bloqueador">
                <Input
                  value={(merged.blocker as string) ?? ""}
                  onChange={(e) => setField("blocker", e.target.value)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Owner do bloqueio">
                  <Input
                    value={(merged.blocker_owner as string) ?? ""}
                    onChange={(e) => setField("blocker_owner", e.target.value)}
                  />
                </Field>
                <Field label="Acao de desbloqueio">
                  <Input
                    value={(merged.unblock_action as string) ?? ""}
                    onChange={(e) => setField("unblock_action", e.target.value)}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Impacto esperado</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Field label="Aquisicao">
                <Input
                  value={(merged.acquisition_impact as string) ?? ""}
                  onChange={(e) => setField("acquisition_impact", e.target.value)}
                />
              </Field>
              <Field label="Conversao">
                <Input
                  value={(merged.conversion_impact as string) ?? ""}
                  onChange={(e) => setField("conversion_impact", e.target.value)}
                />
              </Field>
              <Field label="Retencao">
                <Input
                  value={(merged.retention_impact as string) ?? ""}
                  onChange={(e) => setField("retention_impact", e.target.value)}
                />
              </Field>
              <Field label="Receita">
                <Input
                  value={(merged.revenue_impact as string) ?? ""}
                  onChange={(e) => setField("revenue_impact", e.target.value)}
                />
              </Field>
              <Field label="Risco">
                <Input
                  value={(merged.risk_level as string) ?? ""}
                  onChange={(e) => setField("risk_level", e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <MessageSquare className="h-4 w-4" /> Follow-ups & Historico
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="follow-ups">
                <TabsList>
                  <TabsTrigger value="follow-ups">Follow-ups</TabsTrigger>
                  <TabsTrigger value="activity">Atividade</TabsTrigger>
                </TabsList>
                <TabsContent value="follow-ups" className="space-y-3">
                  <div className="border rounded-md p-3 space-y-2 bg-muted/20">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Alvo</Label>
                        <Input
                          value={newFollowUp.target_person}
                          onChange={(e) =>
                            setNewFollowUp({ ...newFollowUp, target_person: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Tipo</Label>
                        <select
                          value={newFollowUp.message_type}
                          onChange={(e) =>
                            setNewFollowUp({ ...newFollowUp, message_type: e.target.value })
                          }
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          {MESSAGE_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <Textarea
                      rows={2}
                      value={newFollowUp.message_text}
                      onChange={(e) =>
                        setNewFollowUp({ ...newFollowUp, message_text: e.target.value })
                      }
                    />
                    <Button size="sm" onClick={sendFollowUp}>
                      <Send className="h-3 w-3 mr-1" />
                      Registrar follow-up
                    </Button>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    {followUps.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Nenhum follow-up registrado.
                      </p>
                    ) : (
                      followUps.map((f) => (
                        <div key={f.id} className="border rounded-md p-3 text-sm space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px]">
                                #{f.follow_up_number}
                              </Badge>
                              <span className="font-medium">{f.target_person}</span>
                              <Badge variant="secondary" className="text-[10px]">
                                {f.message_type}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px]",
                                  f.reply_status === "no_reply" && "border-red-400 text-red-600",
                                  f.reply_status === "replied" && "border-emerald-400 text-emerald-600"
                                )}
                              >
                                {f.reply_status}
                              </Badge>
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              {formatShortDateTime(f.sent_at_utc)}
                            </span>
                          </div>
                          {f.message_text && (
                            <p className="text-xs text-muted-foreground">
                              {f.message_text}
                            </p>
                          )}
                          {f.reply_status === "pending" && (
                            <div className="flex gap-2 pt-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => markReplied(f.id, "replied")}
                              >
                                Respondido
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => markReplied(f.id, "clarified")}
                              >
                                Esclarecido
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => markReplied(f.id, "no_reply")}
                              >
                                Sem resposta
                              </Button>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="activity">
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {activity.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Sem atividade.</p>
                    ) : (
                      activity.map((e) => (
                        <div
                          key={e.id}
                          className="border-l-2 border-muted pl-3 py-1 text-sm"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">
                              {formatDateTime(e.timestamp_utc)}
                            </span>
                            <Badge variant="outline" className="text-[10px]">
                              {e.event_type}
                            </Badge>
                          </div>
                          <p className="text-xs mt-0.5">{e.summary}</p>
                          {e.actor && (
                            <p className="text-[10px] text-muted-foreground">
                              {e.actor}
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Estado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Status">
                <select
                  value={merged.status}
                  onChange={(e) =>
                    setField("status", e.target.value as Demand["status"])
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {DEMAND_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Prioridade">
                <select
                  value={merged.priority}
                  onChange={(e) =>
                    setField("priority", e.target.value as Demand["priority"])
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Saude">
                <select
                  value={merged.health}
                  onChange={(e) =>
                    setField("health", e.target.value as Demand["health"])
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {HEALTHS.map((h) => (
                    <option key={h} value={h}>
                      {HEALTH_LABEL[h]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Area">
                <select
                  value={merged.area}
                  onChange={(e) =>
                    setField("area", e.target.value as Demand["area"])
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {AREAS.map((a) => (
                    <option key={a} value={a}>
                      {AREA_LABEL[a]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Canal">
                <select
                  value={merged.channel ?? ""}
                  onChange={(e) =>
                    setField(
                      "channel",
                      (e.target.value || null) as Demand["channel"]
                    )
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">-</option>
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Pessoas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Owner">
                <Input
                  value={(merged.owner as string) ?? ""}
                  onChange={(e) => setField("owner", e.target.value)}
                />
              </Field>
              <Field label="Owner secundario">
                <Input
                  value={(merged.secondary_owner as string) ?? ""}
                  onChange={(e) => setField("secondary_owner", e.target.value)}
                />
              </Field>
              <Field label="Requester">
                <Input
                  value={(merged.requester as string) ?? ""}
                  onChange={(e) => setField("requester", e.target.value)}
                />
              </Field>
              <Field label="Atribuido por">
                <Input
                  value={(merged.assigned_by as string) ?? ""}
                  onChange={(e) => setField("assigned_by", e.target.value)}
                />
              </Field>
              <Field label="Resposta requerida de">
                <Input
                  value={(merged.response_required_from as string) ?? ""}
                  onChange={(e) =>
                    setField("response_required_from", e.target.value)
                  }
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="h-4 w-4" /> SLA & Follow-up
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="SLA de resposta (h)">
                <Input
                  type="number"
                  value={merged.reply_sla_hours ?? 3}
                  onChange={(e) =>
                    setField("reply_sla_hours", Number(e.target.value))
                  }
                />
              </Field>
              <Field label="Proximo follow-up (UTC)">
                <Input
                  type="datetime-local"
                  value={isoToLocalInput(merged.next_follow_up_at_utc)}
                  onChange={(e) =>
                    setField(
                      "next_follow_up_at_utc",
                      e.target.value
                        ? new Date(e.target.value).toISOString()
                        : null
                    )
                  }
                />
              </Field>
              <Field label="Prazo final (UTC)">
                <Input
                  type="datetime-local"
                  value={isoToLocalInput(merged.due_at_utc)}
                  onChange={(e) =>
                    setField(
                      "due_at_utc",
                      e.target.value
                        ? new Date(e.target.value).toISOString()
                        : null
                    )
                  }
                />
              </Field>
              <Field label="Regra de follow-up">
                <Input
                  value={(merged.follow_up_rule as string) ?? ""}
                  onChange={(e) => setField("follow_up_rule", e.target.value)}
                />
              </Field>
              <Field label="Regra de escalacao">
                <Input
                  value={(merged.escalation_rule as string) ?? ""}
                  onChange={(e) => setField("escalation_rule", e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Timing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs">
              <Stat label="Criada" value={formatDateTime(merged.created_at_utc)} />
              <Stat
                label="Primeira vez vista"
                value={formatDateTime(merged.first_seen_at_utc)}
              />
              <Stat
                label="Atribuida"
                value={formatDateTime(merged.assigned_at_utc)}
              />
              <Stat
                label="Iniciada"
                value={formatDateTime(merged.started_at_utc)}
              />
              <Stat
                label="Ultimo update"
                value={formatDateTime(merged.last_updated_at_utc)}
              />
              <Stat
                label="Bloqueada em"
                value={formatDateTime(merged.blocked_at_utc)}
              />
              <Stat
                label="Resolvida"
                value={formatDateTime(merged.resolved_at_utc)}
              />
              <Stat
                label="Fechada"
                value={formatDateTime(merged.closed_at_utc)}
              />
              <Stat
                label="Ultima resposta Pricila"
                value={formatDateTime(merged.pricila_last_reply_at_utc)}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-[11px]">{value}</span>
    </div>
  );
}

function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle, Mail, CircleDot, Truck, ShoppingBag, ChevronRight, Send, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/lib/workspace-context";

interface Regua {
  key: string;
  label: string;
  enabled: boolean;
  channel: string;
  detail: string;
}
interface Contact {
  customer_email: string | null;
  customer_phone: string | null;
  channel: string;
  source: string;
  status: string;
  sent_at: string;
}
interface Step {
  label: string;
  when: string;
  kind: "event" | "gate" | "send" | "wait";
}
interface Lane {
  key: string;
  label: string;
  channel: string;
  enabled: boolean;
  steps: Step[];
}
interface Plan {
  cooldown_hours: number;
  lanes: Lane[];
}

const SOURCE_LABEL: Record<string, string> = {
  review: "Avaliação",
  cashback: "Cashback",
  cart_recovery: "Carrinho",
  campaign: "Campanha",
  playbook: "Playbook",
  group: "Grupo",
};

function StepNode({ step }: { step: Step }) {
  const styles: Record<Step["kind"], string> = {
    event: "bg-neutral-100 border-neutral-200 text-neutral-700",
    gate: "bg-amber-100 border-amber-400 text-amber-900",
    send: "bg-neutral-900 border-neutral-900 text-white",
    wait: "bg-neutral-50 border-dashed border-neutral-300 text-neutral-500",
  };
  const icon =
    step.kind === "gate" ? <Truck className="h-3.5 w-3.5" /> :
    step.kind === "send" ? <Send className="h-3.5 w-3.5" /> :
    step.kind === "event" ? <ShoppingBag className="h-3.5 w-3.5" /> :
    <Clock className="h-3.5 w-3.5" />;
  return (
    <div className={`shrink-0 rounded-xl border px-3 py-2 min-w-[150px] ${styles[step.kind]}`}>
      <div className="flex items-center gap-1.5 text-[13px] font-semibold">{icon}{step.label}</div>
      <div className={`text-[11px] mt-0.5 ${step.kind === "send" ? "text-neutral-300" : "text-muted-foreground"}`}>{step.when}</div>
    </div>
  );
}

function FlowLane({ lane }: { lane: Lane }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center gap-2 mb-3">
        <CircleDot className={`h-3.5 w-3.5 ${lane.enabled ? "text-green-500" : "text-neutral-300"}`} />
        <span className="font-semibold text-sm">{lane.label}</span>
        <Badge variant="outline" className="text-[10px] flex items-center gap-1">
          {lane.channel.includes("email") ? <Mail className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}
          {lane.channel}
        </Badge>
        <Badge variant={lane.enabled ? "default" : "secondary"} className="text-[10px] ml-auto">{lane.enabled ? "Ativa" : "Inativa"}</Badge>
      </div>
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {lane.steps.map((s, i) => (
          <React.Fragment key={i}>
            <StepNode step={s} />
            {i < lane.steps.length - 1 && <ChevronRight className="h-4 w-4 text-neutral-300 shrink-0" />}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default function ComunicacoesPage() {
  const { workspace } = useWorkspace();
  const [reguas, setReguas] = useState<Regua[]>([]);
  const [recent, setRecent] = useState<Contact[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [cooldown, setCooldown] = useState(18);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const d = await fetch("/api/comms/overview", { headers: { "x-workspace-id": workspace.id } }).then((r) => r.json());
      setReguas(d.reguas || []);
      setRecent(d.recent || []);
      setPlan(d.plan || null);
      if (d.cooldown_hours) setCooldown(d.cooldown_hours);
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => { if (workspace?.id) load(); }, [workspace?.id, load]);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageCircle className="h-6 w-6" /> Comunicações
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Visão única das réguas automáticas. A régua de avaliações respeita um período de
          carência de <strong>{cooldown}h</strong>: se o cliente recebeu outra comunicação (cashback,
          campanha…) há pouco, o pedido de avaliação é adiado para não se sobrepor.
        </p>
      </div>

      {/* Flow da régua planejada */}
      {plan && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Régua planejada</CardTitle>
            <CardDescription>
              A sequência de cada comunicação. O bloco âmbar <Truck className="inline h-3.5 w-3.5 text-amber-600" /> é um portão:
              só seguimos depois que o pedido é <strong>despachado</strong> (tem rastreio) — vale para avaliações e cashback.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {plan.lanes.map((lane) => <FlowLane key={lane.key} lane={lane} />)}
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Carência entre réguas: <strong>{plan.cooldown_hours}h</strong> — uma régua não dispara se o cliente recebeu outra há menos que isso.
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {reguas.map((r) => (
          <Card key={r.key}>
            <CardContent className="pt-6 flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold flex items-center gap-2">
                  <CircleDot className={`h-3.5 w-3.5 ${r.enabled ? "text-green-500" : "text-neutral-300"}`} />
                  {r.label}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{r.detail}</div>
                <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                  {r.channel.includes("email") ? <Mail className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}
                  {r.channel}
                </div>
              </div>
              <Badge variant={r.enabled ? "default" : "secondary"}>{r.enabled ? "Ativa" : "Inativa"}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contatos recentes (todas as réguas)</CardTitle>
          <CardDescription>
            Envios registrados no log unificado. Réguas que ainda não escrevem aqui aparecem nos cards acima pelo status próprio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : recent.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">Nenhum envio registrado ainda.</div>
          ) : (
            <div className="divide-y">
              {recent.map((c, i) => (
                <div key={i} className="flex items-center justify-between py-2 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-[10px]">{SOURCE_LABEL[c.source] || c.source}</Badge>
                    <span className="truncate text-muted-foreground">{c.customer_email || c.customer_phone || "—"}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      {c.channel === "email" ? <Mail className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}
                      {c.channel}
                    </span>
                    {c.status !== "sent" && <Badge variant="destructive" className="text-[10px]">{c.status}</Badge>}
                    <span>{new Date(c.sent_at).toLocaleString("pt-BR")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

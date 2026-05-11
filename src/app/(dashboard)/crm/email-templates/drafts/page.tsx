"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useWorkspace } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Trash2,
  Copy as CopyIcon,
  Pencil,
  FolderOpen,
  Sparkles,
  ShieldCheck,
  ShieldX,
  Clock,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { SectionNav } from "../_components/section-nav";
import { AIComposeDialog } from "../_components/ai-compose-dialog";

function DraftThumbnail({ id, workspaceId, mode }: { id: string; workspaceId: string; mode: "light" | "dark" }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/crm/email-templates/drafts/${id}/render?track=off`, {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setHtml(d.html ?? "");
      })
      .catch(() => {
        if (!cancelled) setHtml("");
      });
    return () => {
      cancelled = true;
    };
  }, [id, workspaceId]);

  return (
    <div
      className={`relative w-full overflow-hidden border-b ${
        mode === "dark"
          ? "bg-gradient-to-br from-neutral-900 via-neutral-950 to-black"
          : "bg-gradient-to-br from-neutral-50 via-white to-neutral-100"
      }`}
      style={{ height: 240 }}
    >
      {html === null ? (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        </div>
      ) : (
        <iframe
          srcDoc={html}
          sandbox=""
          title="Preview"
          className="border-0 bg-white pointer-events-none"
          style={{
            width: "600px",
            height: "800px",
            transform: "scale(0.46)",
            transformOrigin: "top center",
            position: "absolute",
            left: "50%",
            marginLeft: "-300px",
            top: 0,
          }}
        />
      )}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-12 ${
          mode === "dark"
            ? "bg-gradient-to-t from-black/90 to-transparent"
            : "bg-gradient-to-t from-white/95 to-transparent"
        }`}
      />
    </div>
  );
}

interface DraftRow {
  id: string;
  name: string;
  layout_id: string | null;
  meta: { subject: string; preview: string; mode: "light" | "dark" };
  updated_at: string;
  created_at: string;
  approval_state?: "pending_approval" | "approved" | "rejected" | null;
  scheduled_for?: string | null;
  submitted_by?: string | null;
  submitted_at?: string | null;
  rejection_reason?: string | null;
}

function formatRel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min atrás`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h atrás`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d} d atrás`;
  return new Date(iso).toLocaleDateString();
}

function familyOf(layoutId: string | null): string {
  if (!layoutId) return "custom";
  return layoutId.replace(/-(light|dark)$/, "");
}

export default function DraftsPage() {
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const workspaceId = workspace?.id ?? "";
  const currentUserId = user?.id ?? null;
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const r = await fetch("/api/crm/email-templates/drafts", {
      headers: { "x-workspace-id": workspaceId },
    });
    const d = await r.json();
    setDrafts(d.drafts ?? []);
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: string, name: string) => {
    if (!confirm(`Excluir "${name}"? Essa ação não pode ser desfeita.`)) return;
    setBusyId(id);
    try {
      await fetch(`/api/crm/email-templates/drafts/${id}`, {
        method: "DELETE",
        headers: { "x-workspace-id": workspaceId },
      });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const duplicate = async (id: string) => {
    if (!workspaceId) return;
    setBusyId(id);
    try {
      const r = await fetch(`/api/crm/email-templates/drafts/${id}`, {
        headers: { "x-workspace-id": workspaceId },
      });
      const data = await r.json();
      const src = data.draft;
      if (!src) return;
      await fetch("/api/crm/email-templates/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId },
        body: JSON.stringify({
          draft: {
            name: `${src.name} (cópia)`,
            layout_id: src.layout_id,
            meta: src.meta,
            blocks: src.blocks,
          },
        }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const approve = async (id: string) => {
    setApprovalError(null);
    setBusyId(id);
    try {
      const r = await fetch(`/api/crm/email-templates/drafts/${id}/approve`, {
        method: "POST",
        headers: { "x-workspace-id": workspaceId },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setApprovalError(d.error ?? "Falha ao aprovar.");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: string) => {
    const reason = window.prompt("Motivo da rejeição (opcional):") ?? "";
    if (reason === null) return;
    setApprovalError(null);
    setBusyId(id);
    try {
      const r = await fetch(`/api/crm/email-templates/drafts/${id}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({ reason }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setApprovalError(d.error ?? "Falha ao rejeitar.");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const rename = async (id: string, currentName: string) => {
    const next = window.prompt("Renomear:", currentName);
    if (!next || next.trim() === "" || next === currentName) return;
    setBusyId(id);
    try {
      await fetch(`/api/crm/email-templates/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId },
        body: JSON.stringify({ name: next.trim() }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (!workspaceId) {
    return <div className="p-6 text-muted-foreground">Selecione um workspace.</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="space-y-3">
        <SectionNav />
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Meus templates</h1>
            <p className="text-muted-foreground text-sm">
              Drafts salvos por você e seu time. Os templates originais da{" "}
              <Link href="/crm/email-templates/library" className="underline">
                Galeria
              </Link>{" "}
              ficam intactos — cada edição vira um novo draft aqui.
            </p>
          </div>
          <Button size="sm" onClick={() => setAiOpen(true)} className="gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            Criar com IA
          </Button>
        </div>
      </div>
      <AIComposeDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        workspaceId={workspaceId}
      />

      {approvalError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">{approvalError}</div>
          <button
            onClick={() => setApprovalError(null)}
            className="text-red-400 hover:text-red-300"
          >
            <span className="sr-only">Fechar</span>&times;
          </button>
        </div>
      )}

      {drafts && drafts.some((d) => d.approval_state === "pending_approval") && (
        <Card className="p-4 space-y-3 border-amber-300/40 bg-amber-50/30 dark:bg-amber-950/10">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="w-4 h-4 text-amber-600" />
            Pendentes de aprovação
            <Badge variant="outline" className="text-[10px]">
              {drafts.filter((d) => d.approval_state === "pending_approval").length}
            </Badge>
          </div>
          <div className="space-y-2">
            {drafts
              .filter((d) => d.approval_state === "pending_approval")
              .map((d) => {
                const isAuthor = !!currentUserId && d.submitted_by === currentUserId;
                return (
                  <div
                    key={d.id}
                    className="flex items-center gap-3 p-2.5 border rounded bg-background"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{d.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        Submetido {formatRel(d.submitted_at ?? d.updated_at)}
                        {d.scheduled_for && (
                          <>
                            <span>·</span>
                            <span>
                              Agendado pra{" "}
                              {new Date(d.scheduled_for).toLocaleString("pt-BR", {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                    >
                      <Link href={`/crm/email-templates/editor/${d.id}`}>
                        Ver
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      disabled={busyId === d.id || isAuthor}
                      title={
                        isAuthor
                          ? "Quem submeteu não pode aprovar o próprio rascunho"
                          : "Aprovar e disparar"
                      }
                      onClick={() => approve(d.id)}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1.5 text-destructive hover:text-destructive"
                      disabled={busyId === d.id}
                      onClick={() => reject(d.id)}
                    >
                      <ShieldX className="w-3 h-3" />
                      Rejeitar
                    </Button>
                  </div>
                );
              })}
          </div>
        </Card>
      )}

      {drafts === null ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
        </div>
      ) : drafts.length === 0 ? (
        <Card className="p-10 flex flex-col items-center text-center gap-3">
          <FolderOpen className="w-10 h-10 text-muted-foreground/60" />
          <div className="text-sm font-medium">Nenhum draft ainda</div>
          <p className="text-xs text-muted-foreground max-w-sm">
            Vá até a Galeria, clique em “Usar template” em qualquer layout e
            edite à vontade. Quando salvar, ele aparece aqui.
          </p>
          <Button asChild size="sm" className="mt-2">
            <Link href="/crm/email-templates/library">Ir pra Galeria</Link>
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {drafts.map((d) => {
            const family = familyOf(d.layout_id);
            return (
              <Card
                key={d.id}
                className="p-0 flex flex-col overflow-hidden hover:border-foreground/40 hover:shadow-md transition-all"
              >
                <DraftThumbnail id={d.id} workspaceId={workspaceId} mode={d.meta.mode} />
                <div className="p-4 flex flex-col gap-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate" title={d.name}>
                        {d.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {d.meta.subject || "(sem subject)"}
                      </div>
                    </div>
                    <Badge
                      variant={d.meta.mode === "dark" ? "default" : "outline"}
                      className="text-[10px] px-1.5 h-5 uppercase tracking-widest shrink-0"
                    >
                      {d.meta.mode}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                    <span className="font-mono">{family}</span>
                    <span>·</span>
                    <span>editado {formatRel(d.updated_at)}</span>
                    {d.approval_state === "pending_approval" && (
                      <Badge
                        variant="outline"
                        className="text-[10px] gap-1 border-amber-500/40 text-amber-500"
                      >
                        <ShieldCheck className="w-3 h-3" />
                        Aguardando aprovação
                      </Badge>
                    )}
                    {d.approval_state === "rejected" && (
                      <Badge
                        variant="outline"
                        className="text-[10px] gap-1 border-red-500/40 text-red-500"
                        title={d.rejection_reason ?? undefined}
                      >
                        <ShieldX className="w-3 h-3" />
                        Rejeitado
                      </Badge>
                    )}
                  </div>
                <div className="flex items-center gap-1 pt-1">
                  <Button asChild size="sm" className="flex-1 h-8 gap-1.5 text-xs">
                    <Link href={`/crm/email-templates/editor/${d.id}`}>
                      <Pencil className="w-3 h-3" /> Editar
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 p-0"
                    title="Duplicar"
                    disabled={busyId === d.id}
                    onClick={() => duplicate(d.id)}
                  >
                    <CopyIcon className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 p-0"
                    title="Renomear"
                    disabled={busyId === d.id}
                    onClick={() => rename(d.id, d.name)}
                  >
                    <span className="text-[10px] font-mono">Aa</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    title="Excluir"
                    disabled={busyId === d.id}
                    onClick={() => remove(d.id, d.name)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

// Relatório completo de uma campanha. Mostra:
//   - Header: subject + status + provider + timestamps
//   - Funil: total → entregues → aberturas → cliques (% conversão entre etapas)
//   - GA4: sessões, receita atribuída, transações, ticket médio
//   - Audiência: listas usadas + segmento (UTM term)
//   - Envios (iPORTO): tabela paginada por status
//   - Timeline (iPORTO): últimos eventos do webhook
//   - Preview HTML: iframe com o e-mail renderizado

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWorkspace } from "@/lib/workspace-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  ArrowLeft,
  Mail,
  Eye,
  MousePointerClick,
  AlertOctagon,
  TrendingUp,
  Calendar,
  Send,
  Users,
  DollarSign,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";

interface DispatchDetail {
  dispatch: {
    id: string;
    provider: string | null;
    locaweb_message_id: string | null;
    locaweb_list_ids: string[] | null;
    recipients_total: number | null;
    recipients_sent: number | null;
    recipients_failed: number | null;
    subject: string | null;
    from_email: string | null;
    from_name: string | null;
    html_body: string | null;
    scheduled_to: string | null;
    status: string;
    stats: Record<string, unknown> & {
      utm_campaign?: string;
      utm_term?: string | null;
      target_segment?: string | null;
      delivered?: number;
      opens?: number;
      uniq_opens?: number;
      clicks?: number;
      bounces?: number;
      complaints?: number;
      unsubscribes?: number;
      total?: number;
      last_event_at?: string;
      event_log?: string[];
    };
    last_synced_at: string | null;
    created_at: string;
    draft_id: string | null;
    suggestion_id: string | null;
  };
  locaweb?: {
    overview?: Record<string, unknown>;
  };
  iporto?: {
    envio_counts?: Record<string, number>;
    event_log?: string[];
    last_event_at?: string | null;
  };
  ga4?: {
    sessions?: number;
    users?: number;
    engagement_rate?: number;
    revenue?: number;
    transactions?: number;
    items?: number;
    error?: string;
  };
}

interface EnvioRow {
  id: number;
  email: string;
  name: string | null;
  status: string;
  iporto_message_id: string | null;
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

type StatusFilter = "all" | "pending" | "processing" | "sent" | "failed";

function pct(n: number, d: number): string {
  if (!d) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? "";
  const id = params?.id ?? "";

  const [detail, setDetail] = useState<DispatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Envios pagination (iPORTO only)
  const [envios, setEnvios] = useState<EnvioRow[]>([]);
  const [enviosTotal, setEnviosTotal] = useState(0);
  const [enviosLoading, setEnviosLoading] = useState(false);
  const [enviosStatus, setEnviosStatus] = useState<StatusFilter>("all");
  const [enviosOffset, setEnviosOffset] = useState(0);
  const enviosLimit = 50;

  const load = useCallback(async () => {
    if (!workspaceId || !id) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/crm/email-templates/reports/${id}`, {
        headers: { "x-workspace-id": workspaceId },
        cache: "no-store",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      const d = (await r.json()) as DispatchDetail;
      setDetail(d);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const provider = detail?.dispatch.provider ?? "locaweb";
  const isIporto = provider === "iporto";

  const loadEnvios = useCallback(async () => {
    if (!workspaceId || !id || !isIporto) return;
    setEnviosLoading(true);
    try {
      const url = new URL(
        `/api/crm/email-templates/reports/${id}/envios`,
        window.location.origin
      );
      url.searchParams.set("offset", String(enviosOffset));
      url.searchParams.set("limit", String(enviosLimit));
      if (enviosStatus !== "all") url.searchParams.set("status", enviosStatus);

      const r = await fetch(url.pathname + url.search, {
        headers: { "x-workspace-id": workspaceId },
        cache: "no-store",
      });
      const d = await r.json();
      setEnvios(d.envios ?? []);
      setEnviosTotal(d.total ?? 0);
    } finally {
      setEnviosLoading(false);
    }
  }, [workspaceId, id, isIporto, enviosOffset, enviosStatus]);

  useEffect(() => {
    if (isIporto) void loadEnvios();
  }, [loadEnvios, isIporto]);

  const funnel = useMemo(() => {
    if (!detail) return null;
    const d = detail.dispatch;
    const overview = (detail.locaweb?.overview ?? {}) as Record<string, unknown>;

    const total =
      Number(d.recipients_total ?? 0) ||
      Number(overview.total ?? 0) ||
      Number(d.stats?.total ?? 0);
    const delivered =
      Number(overview.delivered ?? 0) ||
      Number(d.stats?.delivered ?? 0) ||
      Number(d.recipients_sent ?? 0);
    const opens =
      Number(overview.uniq_opens ?? overview.opens ?? 0) ||
      Number(d.stats?.uniq_opens ?? d.stats?.opens ?? 0);
    const clicks =
      Number(overview.clicks ?? 0) || Number(d.stats?.clicks ?? 0);
    const bounces =
      Number(overview.bounces ?? 0) || Number(d.stats?.bounces ?? 0);

    return { total, delivered, opens, clicks, bounces };
  }, [detail]);

  if (!workspaceId) {
    return <div className="p-6 text-muted-foreground">Selecione um workspace.</div>;
  }

  if (loading && !detail) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando relatório...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 space-y-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/crm/email-templates/reports")}
          className="gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar pros relatórios
        </Button>
        <Card className="p-4 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {error}
        </Card>
      </div>
    );
  }

  if (!detail) return null;

  const d = detail.dispatch;
  const ga4 = detail.ga4 ?? {};
  const iporto = detail.iporto;
  const stats = d.stats ?? {};

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/crm/email-templates/reports")}
          className="gap-1.5 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar pros relatórios
        </Button>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">{d.subject ?? "(sem subject)"}</h1>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{stats.utm_campaign ?? "—"}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ProviderBadge provider={provider} />
            <StatusBadge status={d.status} />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground mt-3">
          <span>
            <Calendar className="w-3 h-3 inline mr-1" /> Criada em {fmtDate(d.created_at)}
          </span>
          {d.scheduled_to && (
            <span>
              <Clock className="w-3 h-3 inline mr-1" /> Agendada {fmtDate(d.scheduled_to)}
            </span>
          )}
          {d.last_synced_at && <span>Sync: {fmtDate(d.last_synced_at)}</span>}
          {d.from_email && (
            <span>
              De: <span className="font-mono">{d.from_email}</span>
            </span>
          )}
        </div>
      </div>

      {/* Funil */}
      {funnel && (
        <Card className="p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Funil de entrega
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <FunnelStep
              icon={<Users className="w-4 h-4" />}
              label="Audiência"
              value={funnel.total}
              base={funnel.total}
            />
            <FunnelStep
              icon={<Send className="w-4 h-4" />}
              label="Entregues"
              value={funnel.delivered}
              base={funnel.total}
              tone="positive"
            />
            <FunnelStep
              icon={<Eye className="w-4 h-4" />}
              label="Aberturas"
              value={funnel.opens}
              base={funnel.delivered}
            />
            <FunnelStep
              icon={<MousePointerClick className="w-4 h-4" />}
              label="Cliques"
              value={funnel.clicks}
              base={funnel.opens || funnel.delivered}
            />
            <FunnelStep
              icon={<AlertOctagon className="w-4 h-4" />}
              label="Bounces"
              value={funnel.bounces}
              base={funnel.total}
              tone="negative"
            />
          </div>
        </Card>
      )}

      {/* GA4 */}
      {ga4 && Object.keys(ga4).length > 0 && !ga4.error && (
        <Card className="p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <DollarSign className="w-3 h-3" /> Atribuição GA4
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Sessões" value={(ga4.sessions ?? 0).toLocaleString("pt-BR")} />
            <Kpi label="Usuários" value={(ga4.users ?? 0).toLocaleString("pt-BR")} />
            <Kpi
              label="Receita"
              value={fmtBRL(ga4.revenue ?? 0)}
              tone={(ga4.revenue ?? 0) > 0 ? "positive" : "neutral"}
            />
            <Kpi
              label="Transações"
              value={(ga4.transactions ?? 0).toLocaleString("pt-BR")}
              hint={
                (ga4.transactions ?? 0) > 0
                  ? `Ticket médio ${fmtBRL((ga4.revenue ?? 0) / (ga4.transactions ?? 1))}`
                  : undefined
              }
            />
          </div>
        </Card>
      )}
      {ga4?.error && (
        <Card className="p-3 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/10 border-amber-300/40">
          GA4 indisponível: {ga4.error}
        </Card>
      )}

      {/* Audiência */}
      <Card className="p-4 space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Audiência
        </div>
        <div className="space-y-1 text-sm">
          {(d.locaweb_list_ids ?? []).length === 0 ? (
            <div className="text-muted-foreground text-xs">Sem listas vinculadas.</div>
          ) : (
            (d.locaweb_list_ids ?? []).map((lid) => (
              <div key={lid} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-muted-foreground">#{lid}</span>
                <span>Lista {lid}</span>
              </div>
            ))
          )}
          {stats.target_segment && (
            <div className="text-xs text-muted-foreground pt-1 border-t mt-2">
              Segmento UTM: {stats.target_segment}
            </div>
          )}
        </div>
      </Card>

      {/* iPORTO: tabela de envios per-recipient */}
      {isIporto && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Envios per-recipient
              </div>
              {iporto?.envio_counts && (
                <div className="text-xs text-muted-foreground mt-1 flex gap-3">
                  <span>
                    <CheckCircle2 className="w-3 h-3 inline text-emerald-600" />{" "}
                    {iporto.envio_counts.sent ?? 0} entregues
                  </span>
                  <span>
                    <Clock className="w-3 h-3 inline text-amber-600" />{" "}
                    {(iporto.envio_counts.pending ?? 0) +
                      (iporto.envio_counts.processing ?? 0)}{" "}
                    pendentes
                  </span>
                  <span>
                    <XCircle className="w-3 h-3 inline text-red-600" />{" "}
                    {iporto.envio_counts.failed ?? 0} falharam
                  </span>
                </div>
              )}
            </div>
            <Select
              value={enviosStatus}
              onValueChange={(v) => {
                setEnviosStatus(v as StatusFilter);
                setEnviosOffset(0);
              }}
            >
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="sent">Entregues</SelectItem>
                <SelectItem value="failed">Falharam</SelectItem>
                <SelectItem value="pending">Pendentes</SelectItem>
                <SelectItem value="processing">Processando</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-b">
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="text-left px-3 py-2">Email</th>
                <th className="text-left px-3 py-2">Nome</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Atualizado</th>
                <th className="text-left px-3 py-2">Tentativas</th>
                <th className="text-left px-3 py-2">Erro</th>
              </tr>
            </thead>
            <tbody>
              {enviosLoading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                    Carregando envios...
                  </td>
                </tr>
              )}
              {!enviosLoading && envios.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    Sem envios neste filtro.
                  </td>
                </tr>
              )}
              {!enviosLoading &&
                envios.map((e) => (
                  <tr key={e.id} className="border-b">
                    <td className="px-3 py-2 font-mono">{e.email}</td>
                    <td className="px-3 py-2 text-muted-foreground">{e.name ?? "—"}</td>
                    <td className="px-3 py-2">
                      <EnvioStatusBadge status={e.status} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-[10px]">
                      {fmtDate(e.updated_at)}
                    </td>
                    <td className="px-3 py-2 text-center">{e.attempts}</td>
                    <td className="px-3 py-2 text-[10px] text-red-700 dark:text-red-300 max-w-xs truncate">
                      {e.error ?? "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {enviosTotal > 0 && (
            <div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
              <span>
                {enviosTotal.toLocaleString("pt-BR")} envios · página{" "}
                {Math.floor(enviosOffset / enviosLimit) + 1} de{" "}
                {Math.max(1, Math.ceil(enviosTotal / enviosLimit))}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={enviosOffset <= 0 || enviosLoading}
                  onClick={() =>
                    setEnviosOffset(Math.max(0, enviosOffset - enviosLimit))
                  }
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={
                    enviosOffset + enviosLimit >= enviosTotal || enviosLoading
                  }
                  onClick={() => setEnviosOffset(enviosOffset + enviosLimit)}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Preview HTML */}
      {d.html_body && (
        <Card className="overflow-hidden">
          <div className="border-b p-3 text-[10px] uppercase tracking-widest text-muted-foreground">
            Preview do e-mail
          </div>
          <iframe
            srcDoc={d.html_body}
            sandbox="allow-same-origin"
            className="w-full bg-white"
            style={{ height: "600px" }}
            title="Preview do e-mail"
          />
        </Card>
      )}
    </div>
  );
}

function FunnelStep({
  icon,
  label,
  value,
  base,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  base: number;
  tone?: "positive" | "negative" | "neutral";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "negative"
        ? "text-red-700 dark:text-red-300"
        : "";
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${toneClass}`}>
        {value.toLocaleString("pt-BR")}
      </div>
      <div className="text-[10px] text-muted-foreground">
        {value === base && value > 0 ? "100%" : pct(value, base)} de{" "}
        {base.toLocaleString("pt-BR")}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "negative"
        ? "text-red-700 dark:text-red-300"
        : "";
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const map: Record<string, string> = {
    iporto: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
    locaweb: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-widest ${
        map[provider] ?? "bg-muted"
      }`}
    >
      {provider}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    queued: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    scheduled: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    sending: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
    sent: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    failed: "bg-destructive/15 text-destructive",
    canceled: "bg-muted text-muted-foreground",
    pending_approval: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-widest ${
        map[status] ?? "bg-muted"
      }`}
    >
      {status}
    </span>
  );
}

function EnvioStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    sent: "text-emerald-700 dark:text-emerald-300",
    failed: "text-red-700 dark:text-red-300",
    pending: "text-amber-700 dark:text-amber-300",
    processing: "text-indigo-700 dark:text-indigo-300",
  };
  return (
    <span className={`text-[10px] font-mono uppercase ${map[status] ?? ""}`}>
      {status}
    </span>
  );
}

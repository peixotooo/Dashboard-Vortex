"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  BrainCircuit,
  CheckCircle2,
  CircleDot,
  GitBranch,
  Mail,
  MessageCircle,
  PackageSearch,
  RefreshCw,
  ScanLine,
  Search,
  Send,
  ShieldCheck,
  ShoppingCart,
  UserRound,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { CartIntelligenceDecision } from "@/lib/cart-recovery/intelligence";

type JourneyStep = {
  id: string;
  step_order: number;
  delay_minutes: number;
  whatsapp_enabled: boolean;
  email_enabled: boolean;
  coupon_pct: number;
  coupon_validity_hours: number;
};

type JourneyMessage = {
  id: string;
  step_id: string;
  step_order: number | null;
  delay_minutes: number | null;
  channel: "whatsapp" | "email";
  status: string;
  error: string | null;
  external_id: string | null;
  sent_at: string;
  preview: string;
};

type JourneyCart = {
  id: string;
  customer_name: string | null;
  customer_email: string;
  customer_state: string | null;
  customer_region: string | null;
  cart_total: number | null;
  status: string;
  abandoned_at: string;
  recovered_at: string | null;
  recovery_started_at: string | null;
  recovery_url: string | null;
  coupon_code: string | null;
  has_phone: boolean;
  items: Array<{
    name: string | null;
    sku: string | null;
    quantity: number;
    price: number | null;
    image_url: string | null;
  }>;
};

type Journey = {
  cart: JourneyCart;
  intelligence: CartIntelligenceDecision;
  messages: JourneyMessage[];
};

type JourneyResponse = {
  generated_at: string;
  mode: "shadow" | "pilot" | "active";
  strategy: {
    enabled: boolean;
    expire_after_hours: number;
    current_version: number;
    rollout_percentage: number;
    holdout_percentage: number;
    free_shipping_threshold: number;
    free_shipping_thresholds: Record<string, number>;
    steps: JourneyStep[];
  };
  summary: {
    carts: number;
    high_confidence: number;
    linked_checkout: number;
    recurring: number;
    recovered: number;
    sent_messages: number;
    reason_counts: Record<string, number>;
  };
  journeys: Journey[];
};

type WorkflowNodeData = {
  eyebrow: string;
  title: string;
  description: string;
  icon: WorkflowIcon;
  status?: string;
  statusTone?: "neutral" | "success" | "warning" | "danger";
  details: Array<{ label: string; value: string }>;
  preview?: string;
  hasTarget?: boolean;
  hasSource?: boolean;
};

type WorkflowIcon =
  | "cart"
  | "profile"
  | "checkout"
  | "reason"
  | "decision"
  | "message"
  | "email"
  | "outcome"
  | "guardrail"
  | "step"
  | "product";

type WorkflowNode = Node<WorkflowNodeData, "workflow">;

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const NODE_ICONS: Record<WorkflowIcon, LucideIcon> = {
  cart: ShoppingCart,
  profile: UserRound,
  checkout: ScanLine,
  reason: GitBranch,
  decision: BrainCircuit,
  message: MessageCircle,
  email: Mail,
  outcome: CheckCircle2,
  guardrail: ShieldCheck,
  step: Send,
  product: PackageSearch,
};

const STATUS_LABELS: Record<string, string> = {
  open: "Em recuperação",
  recovered: "Recuperado",
  expired: "Expirado",
  closed: "Encerrado",
  sent: "Enviado",
  failed: "Falhou",
  skipped: "Ignorado",
  sending: "Processando",
  scheduled: "Programado",
  pending: "Aguardando",
  canceled: "Cancelado",
};

function WorkflowNodeCard({ data, selected }: NodeProps<WorkflowNode>) {
  const Icon = NODE_ICONS[data.icon];
  return (
    <div
      className={cn(
        "w-[232px] rounded-md border bg-card px-3 py-3 text-card-foreground shadow-sm transition-shadow",
        selected && "ring-2 ring-ring ring-offset-2 ring-offset-background"
      )}
    >
      {data.hasTarget !== false && (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-2 !w-2 !border-2 !border-card !bg-muted-foreground"
        />
      )}
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/50">
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {data.eyebrow}
          </div>
          <div className="mt-0.5 text-sm font-medium leading-snug">{data.title}</div>
        </div>
        {data.status && (
          <CircleDot
            className={cn(
              "mt-1 size-3 shrink-0",
              data.statusTone === "success" && "text-[var(--success)]",
              data.statusTone === "warning" && "text-[var(--warning)]",
              data.statusTone === "danger" && "text-destructive",
              (!data.statusTone || data.statusTone === "neutral") &&
                "text-muted-foreground"
            )}
            aria-label={data.status}
          />
        )}
      </div>
      <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
        {data.description}
      </p>
      {data.status && (
        <div className="mt-2 text-[10px] font-medium text-muted-foreground">
          {data.status}
        </div>
      )}
      {data.hasSource !== false && (
        <Handle
          type="source"
          position={Position.Right}
          className="!h-2 !w-2 !border-2 !border-card !bg-muted-foreground"
        />
      )}
    </div>
  );
}

const nodeTypes = { workflow: WorkflowNodeCard };

export function CartRecoveryJourneyWorkflow({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<JourneyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"actual" | "strategy">("actual");
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/crm/cart-recovery/journey?limit=80", {
        headers: { "x-workspace-id": workspaceId },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível carregar a jornada");
      const next = body as JourneyResponse;
      setData(next);
      setSelectedJourneyId((current) => {
        if (current && next.journeys.some((journey) => journey.cart.id === current)) {
          return current;
        }
        return (
          next.journeys.find((journey) => journey.cart.status === "open")?.cart.id ||
          next.journeys[0]?.cart.id ||
          null
        );
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar jornada");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredJourneys = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    return data.journeys.filter((journey) => {
      if (statusFilter !== "all" && journey.cart.status !== statusFilter) return false;
      if (!needle) return true;
      return [
        journey.cart.customer_name,
        journey.cart.customer_email,
        journey.intelligence.reason.label,
        journey.cart.customer_state,
      ].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [data, query, statusFilter]);

  const selectedJourney = useMemo(
    () => data?.journeys.find((journey) => journey.cart.id === selectedJourneyId) || null,
    [data, selectedJourneyId]
  );

  useEffect(() => {
    if (!data) return;
    const graph =
      mode === "strategy"
        ? buildStrategyGraph(data.strategy.steps)
        : selectedJourney
          ? buildActualJourneyGraph(selectedJourney, data.strategy.steps)
          : { nodes: [], edges: [] };
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setSelectedNodeId(graph.nodes[0]?.id || null);
  }, [data, mode, selectedJourney, setEdges, setNodes]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;

  if (loading) {
    return (
      <div className="flex min-h-[520px] items-center justify-center rounded-md border bg-card">
        <RefreshCw className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 rounded-md border bg-card px-6 text-center">
        <XCircle className="size-5 text-destructive" aria-hidden="true" />
        <p className="text-sm font-medium">{error}</p>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!data || data.journeys.length === 0) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-2 rounded-md border bg-card px-6 text-center">
        <ShoppingCart className="size-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">Nenhum carrinho para mapear</p>
      </div>
    );
  }

  const confidencePct = data.summary.carts
    ? Math.round((data.summary.high_confidence / data.summary.carts) * 100)
    : 0;
  const linkedPct = data.summary.carts
    ? Math.round((data.summary.linked_checkout / data.summary.carts) * 100)
    : 0;

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      <div className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-3">
        <SummaryMetric label="Carrinhos mapeados" value={String(data.summary.carts)} />
        <SummaryMetric label="Diagnóstico forte" value={`${confidencePct}%`} />
        <SummaryMetric label="Checkout conectado" value={`${linkedPct}%`} />
      </div>

      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="grid w-full grid-cols-2 rounded-md border bg-muted/40 p-0.5 md:inline-flex md:w-fit">
          <Button
            type="button"
            size="sm"
            variant={mode === "actual" ? "secondary" : "ghost"}
            onClick={() => setMode("actual")}
            className="min-w-0 px-2 md:px-3"
          >
            Jornada real
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "strategy" ? "secondary" : "ghost"}
            onClick={() => setMode("strategy")}
            className="min-w-0 px-2 md:px-3"
          >
            <span className="sm:hidden">Estratégia</span>
            <span className="hidden sm:inline">Mapa da estratégia</span>
          </Button>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{modeLabel(data.mode)}</Badge>
          <span className="whitespace-nowrap">
            Atualizado {formatDateTime(data.generated_at)}
          </span>
          <Button variant="ghost" size="icon" onClick={load} aria-label="Atualizar jornada">
            <RefreshCw className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {mode === "actual" && (
        <div className="grid gap-2 lg:hidden">
          <Select value={selectedJourneyId || ""} onValueChange={setSelectedJourneyId}>
            <SelectTrigger className="min-w-0 w-full [&>span]:truncate">
              <SelectValue placeholder="Selecione um carrinho" />
            </SelectTrigger>
            <SelectContent>
              {filteredJourneys.map((journey) => (
                <SelectItem key={journey.cart.id} value={journey.cart.id}>
                  {journey.cart.customer_name || journey.cart.customer_email} · {journey.intelligence.reason.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div
        className={cn(
          "grid min-w-0 gap-4",
          mode === "actual"
            ? "lg:grid-cols-[260px_minmax(0,1fr)_300px]"
            : "lg:grid-cols-[minmax(0,1fr)_300px]"
        )}
      >
        {mode === "actual" && (
          <Card className="hidden min-w-0 lg:block">
            <CardHeader className="space-y-3 pb-3">
              <CardTitle className="text-sm">Carrinhos</CardTitle>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar cliente ou motivo"
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="open">Em recuperação</SelectItem>
                  <SelectItem value="recovered">Recuperados</SelectItem>
                  <SelectItem value="expired">Expirados</SelectItem>
                  <SelectItem value="closed">Encerrados</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="max-h-[620px] space-y-0 overflow-y-auto p-0">
              {filteredJourneys.map((journey) => (
                <button
                  key={journey.cart.id}
                  type="button"
                  onClick={() => setSelectedJourneyId(journey.cart.id)}
                  className={cn(
                    "w-full border-t px-4 py-3 text-left transition-colors hover:bg-muted/50",
                    selectedJourneyId === journey.cart.id && "bg-muted"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">
                      {journey.cart.customer_name || "Cliente sem nome"}
                    </span>
                    <StatusDot status={journey.cart.status} />
                  </div>
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    {journey.intelligence.reason.label}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{BRL.format(journey.cart.cart_total || 0)}</span>
                    <span>{Math.round(journey.intelligence.reason.confidence * 100)}% confiança</span>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        <Card className="min-w-0 overflow-hidden">
          <CardContent className="h-[620px] p-0 md:h-[700px]">
            <ReactFlow
              key={`${mode}:${selectedJourneyId || "strategy"}`}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              minZoom={0.25}
              maxZoom={1.5}
              defaultEdgeOptions={{
                type: "smoothstep",
                markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
                style: { stroke: "var(--muted-foreground)", strokeWidth: 1.15 },
              }}
              proOptions={{ hideAttribution: true }}
              colorMode="system"
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={18}
                size={1}
                color="var(--border)"
              />
              <Controls showInteractive={false} position="bottom-right" />
              <MiniMap
                className="hidden md:block"
                pannable
                zoomable
                nodeColor="var(--muted-foreground)"
                maskColor="color-mix(in oklab, var(--background) 72%, transparent)"
                style={{ backgroundColor: "var(--card)" }}
              />
            </ReactFlow>
          </CardContent>
        </Card>

        <NodeDetails node={selectedNode} journey={mode === "actual" ? selectedJourney : null} />
      </div>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-lg font-medium">{value}</div>
    </div>
  );
}

function NodeDetails({ node, journey }: { node: WorkflowNode | null; journey: Journey | null }) {
  if (!node) {
    return (
      <Card>
        <CardContent className="flex min-h-[180px] items-center justify-center text-xs text-muted-foreground">
          Selecione um ponto da jornada
        </CardContent>
      </Card>
    );
  }
  const Icon = NODE_ICONS[node.data.icon];
  return (
    <Card className="min-w-0 self-start">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md border bg-muted/50">
            <Icon className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {node.data.eyebrow}
            </div>
            <CardTitle className="mt-0.5 text-sm">{node.data.title}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {node.data.description}
        </p>
        {node.data.details.length > 0 && (
          <dl className="divide-y border-y text-xs">
            {node.data.details.map((detail) => (
              <div key={`${detail.label}:${detail.value}`} className="grid grid-cols-[92px_1fr] gap-3 py-2.5">
                <dt className="text-muted-foreground">{detail.label}</dt>
                <dd className="break-words font-medium">{detail.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {node.data.preview && (
          <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
            {node.data.preview}
          </div>
        )}
        {journey?.cart.recovery_url && node.data.icon === "decision" && (
          <Button asChild variant="outline" size="sm" className="w-full">
            <a href={journey.cart.recovery_url} target="_blank" rel="noreferrer">
              Abrir carrinho
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function buildActualJourneyGraph(
  journey: Journey,
  steps: JourneyStep[]
): { nodes: WorkflowNode[]; edges: Edge[] } {
  const nodes: WorkflowNode[] = [];
  const edges: Edge[] = [];
  const intelligence = journey.intelligence;
  const startAt = new Date(
    journey.cart.recovery_started_at || journey.cart.abandoned_at
  ).getTime();
  const now = Date.now();

  nodes.push(
    workflowNode("capture", 0, 130, {
      eyebrow: "Entrada",
      title: "Carrinho capturado",
      description: `${journey.cart.items.length} item(ns) · ${BRL.format(journey.cart.cart_total || 0)}`,
      icon: "cart",
      details: [
        { label: "Cliente", value: journey.cart.customer_name || journey.cart.customer_email },
        { label: "Abandono", value: formatDateTime(journey.cart.abandoned_at) },
        { label: "Estado", value: journey.cart.customer_state || "Não identificado" },
      ],
      hasTarget: false,
    }),
    workflowNode("profile", 290, 10, {
      eyebrow: "Cliente",
      title: lifecycleLabel(intelligence.customer.lifecycle),
      description:
        intelligence.customer.priorOrders > 0
          ? `${intelligence.customer.priorOrders} compra(s) anteriores`
          : "Sem compra anterior identificada",
      icon: "profile",
      details: [
        { label: "Compras", value: String(intelligence.customer.priorOrders) },
        { label: "Receita", value: BRL.format(intelligence.customer.priorRevenue) },
        { label: "Cupons", value: intelligence.customer.couponSensitivity },
      ],
    }),
    workflowNode("checkout", 290, 250, {
      eyebrow: "Checkout",
      title: intelligence.checkout.linked
        ? humanize(intelligence.checkout.lastStep || "etapa indefinida")
        : "Sessão não conectada",
      description: intelligence.checkout.linked
        ? `Último campo: ${humanize(intelligence.checkout.lastFieldKey || "não identificado")}`
        : "O pixel ainda não encontrou uma sessão próxima com a mesma identidade.",
      icon: "checkout",
      status: intelligence.checkout.linked ? "Conectado" : "Sem vínculo",
      statusTone: intelligence.checkout.linked ? "success" : "warning",
      details: [
        { label: "Etapa", value: humanize(intelligence.checkout.lastStep || "indefinida") },
        { label: "Campo", value: humanize(intelligence.checkout.lastFieldKey || "indefinido") },
        { label: "Pagamento", value: humanize(intelligence.checkout.paymentMethod || "não selecionado") },
        { label: "Frete", value: humanize(intelligence.checkout.shippingMethod || "não selecionado") },
      ],
    }),
    workflowNode("reason", 600, 130, {
      eyebrow: "Diagnóstico",
      title: intelligence.reason.label,
      description: intelligence.reason.evidence
        .slice(0, 2)
        .map((item) => `${item.label}: ${item.value}`)
        .join(" · "),
      icon: "reason",
      status: `${Math.round(intelligence.reason.confidence * 100)}% de confiança`,
      statusTone: intelligence.reason.confidence >= 0.8 ? "success" : "warning",
      details: intelligence.reason.evidence.map((item) => ({
        label: item.label,
        value: item.value,
      })),
    }),
    workflowNode("decision", 900, 130, {
      eyebrow: "Próxima ação",
      title: intelligence.action.label,
      description: intelligence.action.rationale,
      icon: "decision",
      status:
        intelligence.mode === "shadow"
          ? "Somente observação"
          : intelligence.mode === "pilot"
            ? "Piloto controlado"
            : "Ativa",
      statusTone: "neutral",
      details: [
        { label: "Canal", value: humanize(intelligence.action.channel) },
        { label: "Espera", value: formatDelay(intelligence.action.delayMinutes) },
        { label: "Incentivo", value: humanize(intelligence.action.incentive) },
        ...intelligence.action.guardrails.slice(0, 3).map((guardrail, index) => ({
          label: index === 0 ? "Proteções" : "",
          value: guardrail,
        })),
      ],
    })
  );

  connect(edges, "capture", "profile");
  connect(edges, "capture", "checkout");
  connect(edges, "profile", "reason");
  connect(edges, "checkout", "reason");
  connect(edges, "reason", "decision");

  let previousIds = ["decision"];
  const orderedSteps = steps.slice().sort((a, b) => a.step_order - b.step_order);
  orderedSteps.forEach((step, index) => {
    const gateId = `step-${step.id}`;
    const gateX = 1210 + index * 510;
    const fireAt = startAt + step.delay_minutes * 60 * 1000;
    const stepMessages = journey.messages.filter((message) => message.step_id === step.id);
    const stepStatus = stepMessages.some((message) => message.status === "sent")
      ? "Executado"
      : journey.cart.status === "recovered"
        ? "Cancelado pela compra"
        : fireAt <= now
          ? "Processando"
          : `Previsto ${formatDateTime(new Date(fireAt).toISOString())}`;

    nodes.push(
      workflowNode(gateId, gateX, 130, {
        eyebrow: `Contato ${step.step_order}`,
        title: `${formatDelay(step.delay_minutes)} após o início`,
        description:
          step.coupon_pct > 0
            ? `Inclui cupom de ${step.coupon_pct}% por ${step.coupon_validity_hours}h`
            : "Sem novo incentivo financeiro",
        icon: "step",
        status: stepStatus,
        statusTone: stepMessages.some((message) => message.status === "sent")
          ? "success"
          : "neutral",
        details: [
          { label: "WhatsApp", value: step.whatsapp_enabled ? "Ativo" : "Desativado" },
          { label: "Email", value: step.email_enabled ? "Ativo" : "Desativado" },
          { label: "Cupom", value: step.coupon_pct > 0 ? `${step.coupon_pct}%` : "Não" },
        ],
      })
    );
    previousIds.forEach((previousId) => connect(edges, previousId, gateId));

    const channelIds: string[] = [];
    const channels: Array<"whatsapp" | "email"> = [];
    if (step.whatsapp_enabled) channels.push("whatsapp");
    if (step.email_enabled) channels.push("email");
    channels.forEach((channel, channelIndex) => {
      const message = stepMessages.find((item) => item.channel === channel);
      const channelId = `${gateId}-${channel}`;
      const channelStatus = message?.status ||
        (journey.cart.status === "recovered" ? "canceled" : fireAt <= now ? "pending" : "scheduled");
      nodes.push(
        workflowNode(channelId, gateX + 260, channelIndex === 0 ? 10 : 250, {
          eyebrow: channel === "whatsapp" ? "WhatsApp" : "Email",
          title: message
            ? STATUS_LABELS[message.status] || humanize(message.status)
            : STATUS_LABELS[channelStatus] || humanize(channelStatus),
          description: message?.preview ||
            (channelStatus === "canceled"
              ? "Contato interrompido porque o carrinho converteu."
              : `Disparo previsto para ${formatDateTime(new Date(fireAt).toISOString())}`),
          icon: channel === "whatsapp" ? "message" : "email",
          status: message ? formatDateTime(message.sent_at) : STATUS_LABELS[channelStatus],
          statusTone: toneForStatus(channelStatus),
          details: [
            { label: "Status", value: STATUS_LABELS[channelStatus] || humanize(channelStatus) },
            { label: "Horário", value: message ? formatDateTime(message.sent_at) : formatDateTime(new Date(fireAt).toISOString()) },
            ...(message?.error ? [{ label: "Erro", value: message.error }] : []),
          ],
          preview: message?.preview,
        })
      );
      connect(edges, gateId, channelId);
      channelIds.push(channelId);
    });
    previousIds = channelIds.length > 0 ? channelIds : [gateId];
  });

  const outcomeX = 1210 + orderedSteps.length * 510;
  const outcomeStatus = journey.cart.status;
  nodes.push(
    workflowNode("outcome", outcomeX, 130, {
      eyebrow: "Resultado",
      title: STATUS_LABELS[outcomeStatus] || humanize(outcomeStatus),
      description:
        outcomeStatus === "recovered"
          ? `Compra recuperada em ${formatDateTime(journey.cart.recovered_at || "")}`
          : outcomeStatus === "open"
            ? "A jornada continua monitorando compra e próximos contatos."
            : "A régua foi encerrada sem conversão atribuída.",
      icon: "outcome",
      status: STATUS_LABELS[outcomeStatus] || outcomeStatus,
      statusTone: toneForStatus(outcomeStatus),
      details: [
        { label: "Valor", value: BRL.format(journey.cart.cart_total || 0) },
        { label: "Mensagens", value: String(journey.messages.length) },
        { label: "Status", value: STATUS_LABELS[outcomeStatus] || humanize(outcomeStatus) },
      ],
      hasSource: false,
    })
  );
  previousIds.forEach((previousId) => connect(edges, previousId, "outcome"));

  return { nodes, edges };
}

function buildStrategyGraph(steps: JourneyStep[]): { nodes: WorkflowNode[]; edges: Edge[] } {
  const edges: Edge[] = [];
  const nodes: WorkflowNode[] = [
    workflowNode("strategy-capture", 0, 170, {
      eyebrow: "Entrada",
      title: "Carrinho VNDA",
      description: "Itens, valor, frete, prazo, cupom e contexto do produto.",
      icon: "cart",
      details: [
        { label: "Fonte", value: "Webhook + importação de segurança" },
        { label: "Modo", value: "Sem reiniciar a régua atual" },
      ],
      hasTarget: false,
    }),
    workflowNode("strategy-profile", 290, 30, {
      eyebrow: "Identidade",
      title: "Perfil do cliente",
      description: "Novo, recorrente, fiel ou VIP com histórico e sensibilidade a cupom.",
      icon: "profile",
      details: [
        { label: "Dados", value: "CRM, RFM e pedidos anteriores" },
        { label: "Privacidade", value: "Sem PII dentro dos eventos analíticos" },
      ],
    }),
    workflowNode("strategy-checkout", 290, 310, {
      eyebrow: "Comportamento",
      title: "Pixel de checkout",
      description: "Etapa, campo, erro, pagamento e modalidade de entrega.",
      icon: "checkout",
      details: [
        { label: "Vínculo", value: "consumer_id + email protegido" },
        { label: "Janela", value: "Sessão mais próxima do abandono" },
      ],
    }),
    workflowNode("strategy-classifier", 590, 170, {
      eyebrow: "Inteligência",
      title: "Classificador explicável",
      description: "Cada hipótese recebe confiança e evidências auditáveis.",
      icon: "reason",
      details: [
        { label: "Versão", value: "rules-2026-07-09.1" },
        { label: "Regra", value: "Não afirmar motivo com baixa confiança" },
      ],
    }),
  ];
  connectMany(edges, ["strategy-capture"], ["strategy-profile", "strategy-checkout"]);
  connectMany(edges, ["strategy-profile", "strategy-checkout"], ["strategy-classifier"]);

  const reasonNodes = [
    { id: "reason-payment", title: "Pagamento", description: "Recusa, erro ou método escolhido.", y: -80 },
    { id: "reason-shipping", title: "Frete e prazo", description: "Custo, SLA, UF e disponibilidade.", y: 80 },
    { id: "reason-form", title: "Cadastro e cupom", description: "Validação, endereço ou benefício.", y: 240 },
    { id: "reason-unknown", title: "Baixa evidência", description: "Mensagem neutra ou espera.", y: 400 },
  ];
  reasonNodes.forEach((reason) => {
    nodes.push(
      workflowNode(reason.id, 890, reason.y, {
        eyebrow: "Hipótese",
        title: reason.title,
        description: reason.description,
        icon: "reason",
        details: [{ label: "Saída", value: "Motivo + confiança + evidências" }],
      })
    );
    connect(edges, "strategy-classifier", reason.id);
  });

  nodes.push(
    workflowNode("strategy-policy", 1190, 170, {
      eyebrow: "Política",
      title: "Próxima melhor ação",
      description: "Escolhe canal, espera, conteúdo e proteção de margem.",
      icon: "decision",
      details: [
        { label: "Prioridade", value: "Lucro incremental, não último clique" },
        { label: "Incentivo", value: "Somente quando a margem justificar" },
      ],
    })
  );
  connectMany(edges, reasonNodes.map((reason) => reason.id), ["strategy-policy"]);

  let previous = "strategy-policy";
  steps
    .slice()
    .sort((a, b) => a.step_order - b.step_order)
    .forEach((step, index) => {
      const id = `strategy-step-${step.id}`;
      nodes.push(
        workflowNode(id, 1490 + index * 300, 170, {
          eyebrow: `Contato ${step.step_order}`,
          title: formatDelay(step.delay_minutes),
          description: [
            step.whatsapp_enabled ? "WhatsApp" : null,
            step.email_enabled ? "Email" : null,
            step.coupon_pct > 0 ? `${step.coupon_pct}% off` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          icon: "step",
          details: [
            { label: "Espera", value: formatDelay(step.delay_minutes) },
            { label: "WhatsApp", value: step.whatsapp_enabled ? "Ativo" : "Desativado" },
            { label: "Email", value: step.email_enabled ? "Ativo" : "Desativado" },
            { label: "Cupom", value: step.coupon_pct ? `${step.coupon_pct}%` : "Não" },
          ],
        })
      );
      connect(edges, previous, id);
      previous = id;
    });

  nodes.push(
    workflowNode("strategy-outcome", 1490 + steps.length * 300, 170, {
      eyebrow: "Feedback",
      title: "Compra ou encerramento",
      description: "Cancela a fila, calcula resultado incremental e alimenta o aprendizado.",
      icon: "outcome",
      details: [
        { label: "Conversão", value: "Webhook de pedido confirmado" },
        { label: "Métrica", value: "Receita e margem incremental" },
      ],
      hasSource: false,
    })
  );
  connect(edges, previous, "strategy-outcome");
  return { nodes, edges };
}

function workflowNode(
  id: string,
  x: number,
  y: number,
  data: WorkflowNodeData
): WorkflowNode {
  const handles = [];
  if (data.hasTarget !== false) {
    handles.push({
      id: null,
      type: "target" as const,
      position: Position.Left,
      x: -4,
      y: 52,
      width: 8,
      height: 8,
    });
  }
  if (data.hasSource !== false) {
    handles.push({
      id: null,
      type: "source" as const,
      position: Position.Right,
      x: 228,
      y: 52,
      width: 8,
      height: 8,
    });
  }
  return {
    id,
    type: "workflow",
    position: { x, y },
    data,
    width: 232,
    height: 112,
    initialWidth: 232,
    initialHeight: 112,
    handles,
  };
}

function connect(edges: Edge[], source: string, target: string) {
  edges.push({ id: `${source}:${target}`, source, target });
}

function connectMany(edges: Edge[], sources: string[], targets: string[]) {
  sources.forEach((source) => targets.forEach((target) => connect(edges, source, target)));
}

function toneForStatus(status: string): WorkflowNodeData["statusTone"] {
  if (status === "sent" || status === "recovered") return "success";
  if (status === "failed" || status === "expired") return "danger";
  if (status === "skipped" || status === "pending") return "warning";
  return "neutral";
}

function StatusDot({ status }: { status: string }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <span
        className={cn(
          "size-1.5 rounded-full bg-muted-foreground",
          status === "recovered" && "bg-[var(--success)]",
          status === "expired" && "bg-destructive",
          status === "open" && "bg-[var(--warning)]"
        )}
      />
      {STATUS_LABELS[status] || humanize(status)}
    </span>
  );
}

function lifecycleLabel(value: string): string {
  return (
    {
      new: "Primeira compra",
      returning: "Cliente recorrente",
      loyal: "Cliente fiel",
      vip: "Cliente VIP",
    }[value] || humanize(value)
  );
}

function modeLabel(value: JourneyResponse["mode"]): string {
  if (value === "active") return "Inteligência ativa";
  if (value === "pilot") return "Piloto controlado";
  return "Modo sombra";
}

function humanize(value: string): string {
  if (!value) return "Não identificado";
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDelay(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} d`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

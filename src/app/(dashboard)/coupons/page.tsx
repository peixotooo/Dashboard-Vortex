"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkspace } from "@/lib/workspace-context";
import { Tag, Loader2, Plus, CheckCircle2, XCircle, PauseCircle, Clock, Trash2, Settings, Play, ExternalLink, ShieldCheck, AlertTriangle } from "lucide-react";

interface Plan {
  id: string;
  name: string;
  enabled: boolean;
  mode: "one_shot" | "recurring" | "smart";
  target: "tier_b" | "tier_c" | "low_cvr_high_views" | "manual";
  manual_product_ids: string[] | null;
  discount_min_pct: number;
  discount_max_pct: number;
  duration_hours: number;
  max_active_products: number;
  recurring_cron: string | null;
  recurring_last_run_at: string | null;
  require_manual_approval: boolean;
  discount_unit: "pct" | "brl" | "auto";
  cooldown_days: number;
  badge_template: string;
  badge_bg_color: string;
  badge_text_color: string;
  created_at: string;
}

interface BanditStats {
  pct_attempts: number;
  pct_revenue: number;
  pct_units: number;
  brl_attempts: number;
  brl_revenue: number;
  brl_units: number;
  last_recomputed_at: string | null;
}

interface AuditEntry {
  id: string;
  action: string;
  actor: string | null;
  product_id: string | null;
  details: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
}

interface ActiveCoupon {
  id: string;
  product_id: string;
  vnda_coupon_code: string;
  vnda_discount_id: number | null;
  discount_pct: number;
  starts_at: string;
  expires_at: string;
  status: "pending" | "active" | "paused" | "expired" | "cancelled" | "failed";
  status_reason: string | null;
  attributed_revenue: number;
  attributed_units: number;
  created_at: string;
  // Enriched
  product_name?: string | null;
  product_url?: string | null;
  product_image_url?: string | null;
  product_price?: number | null;
  product_sale_price?: number | null;
  discount_unit?: "pct" | "brl";
  discount_value_brl?: number | null;
}

interface VndaVerify {
  ok: boolean;
  error?: string;
  promotion_exists?: boolean;
  promotion_enabled?: boolean | null;
  promotion_name?: string | null;
  coupon_code_exists?: boolean;
  coupon_uses_per_code?: number | null;
  coupon_used_count?: number | null;
  vnda_discount_id?: number;
}

interface Settings {
  global_max_discount_pct: number;
  global_max_active_coupons: number;
  pending_approval_ttl_hours: number;
  default_uses_per_code: number;
  default_uses_per_user: number;
  cumulative_with_other_promos: boolean;
  notify_on_creation: boolean;
  notify_on_failure: boolean;
}

const EMPTY_PLAN: Partial<Plan> = {
  name: "",
  enabled: true,
  mode: "smart",
  target: "low_cvr_high_views",
  discount_min_pct: 10,
  discount_max_pct: 20,
  duration_hours: 48,
  max_active_products: 5,
  require_manual_approval: false,
  discount_unit: "auto",
  cooldown_days: 7,
  badge_template: "{discount}% OFF | Cupom {coupon} | Acaba em {countdown}",
  badge_bg_color: "#dc2626",
  badge_text_color: "#ffffff",
};

const MODE_LABELS: Record<string, string> = {
  smart: "Smart (totalmente automático)",
  recurring: "Recorrente (cron manual)",
  one_shot: "Pontual (não renova)",
};

const DISCOUNT_UNIT_LABELS: Record<string, string> = {
  pct: "Percentual (%)",
  brl: "Reais (R$)",
  auto: "Auto (bandit decide)",
};

const TARGET_LABELS: Record<string, string> = {
  low_cvr_high_views: "Muito visto + pouca conversão",
  tier_b: "Tier B (vendas médias)",
  tier_c: "Tier C (cauda longa)",
  manual: "IDs manuais",
};

function fmtBRL(v: number) { return "R$ " + v.toFixed(2).replace(".", ","); }

export default function CouponsPage() {
  const { workspace } = useWorkspace();
  const [tab, setTab] = useState("plans");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [pending, setPending] = useState<ActiveCoupon[]>([]);
  const [active, setActive] = useState<ActiveCoupon[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Plan> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, VndaVerify>>({});
  const [banditStats, setBanditStats] = useState<BanditStats | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);

  const headers = useCallback(
    () => ({ "Content-Type": "application/json", "x-workspace-id": workspace?.id || "" }),
    [workspace?.id]
  );

  const reload = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const [plansRes, pendingRes, activeRes, settingsRes, banditRes, auditRes] = await Promise.all([
        fetch("/api/coupons/plans", { headers: headers() }).then(r => r.json()),
        fetch("/api/coupons/active?status=pending", { headers: headers() }).then(r => r.json()),
        fetch("/api/coupons/active?status=active", { headers: headers() }).then(r => r.json()),
        fetch("/api/coupons/settings", { headers: headers() }).then(r => r.json()),
        fetch("/api/coupons/bandit-stats", { headers: headers() }).then(r => r.json()),
        fetch("/api/coupons/audit-log", { headers: headers() }).then(r => r.json()),
      ]);
      setPlans(plansRes.plans || []);
      setPending(pendingRes.coupons || []);
      setActive(activeRes.coupons || []);
      setSettings(settingsRes.settings || null);
      setBanditStats(banditRes.stats || null);
      setAuditEntries(auditRes.entries || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    }
    setLoading(false);
  }, [workspace?.id, headers]);

  async function recomputeBandit() {
    setBusy("bandit-recompute");
    setError(null);
    try {
      const res = await fetch("/api/coupons/bandit-stats", {
        method: "POST",
        headers: headers(),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setBanditStats(data.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    }
    setBusy(null);
  }

  async function syncCouponAttribution(id: string) {
    setBusy("sync-" + id);
    setError(null);
    try {
      const res = await fetch(`/api/coupons/active/${id}/sync-attribution`, {
        method: "POST",
        headers: headers(),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setActive((prev) =>
          prev.map((c) =>
            c.id === id
              ? { ...c, attributed_revenue: data.attributed_revenue, attributed_units: data.attributed_units }
              : c
          )
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    }
    setBusy(null);
  }

  useEffect(() => { reload(); }, [reload]);

  async function savePlan() {
    if (!editing || !editing.name) return;
    setError(null);
    setBusy("save");
    try {
      const path = editing.id ? `/api/coupons/plans/${editing.id}` : "/api/coupons/plans";
      const method = editing.id ? "PATCH" : "POST";
      const res = await fetch(path, { method, headers: headers(), body: JSON.stringify(editing) });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setEditing(null); await reload(); }
    } catch (e) { setError(e instanceof Error ? e.message : "erro"); }
    setBusy(null);
  }

  async function runPlanNow(id: string) {
    setError(null);
    setBusy("run-" + id);
    try {
      const res = await fetch(`/api/coupons/plans/${id}/run`, {
        method: "POST", headers: headers(),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        const msg = data.require_manual_approval
          ? `${data.proposed} sugestao(oes) criada(s). Veja na aba "Aguardando aprovacao".`
          : `${data.proposed} sugestao(oes) criada(s) e ${data.auto_approved} aprovada(s) automaticamente.`;
        // Switch to the relevant tab so user sees the result immediately
        setTab(data.require_manual_approval ? "pending" : "active");
        setError(null);
        // Use error banner styling-agnostic alert via setError ainda nao serve;
        // a aba ja mostra o resultado.
        await reload();
        // Pequena toast info
        setTimeout(() => alert(msg), 50);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    }
    setBusy(null);
  }

  async function disablePlan(id: string) {
    if (!confirm("Desabilitar este plano? Cupons ativos continuam ate expirar.")) return;
    setBusy("del-" + id);
    await fetch(`/api/coupons/plans/${id}`, { method: "DELETE", headers: headers() });
    await reload();
    setBusy(null);
  }

  async function verifyOnVnda(id: string) {
    setBusy("verify-" + id);
    try {
      const res = await fetch(`/api/coupons/active/${id}/verify`, { headers: headers() });
      const data = await res.json();
      setVerifyResults((prev) => ({ ...prev, [id]: data }));
    } catch (e) {
      setVerifyResults((prev) => ({ ...prev, [id]: { ok: false, error: e instanceof Error ? e.message : "erro" } }));
    }
    setBusy(null);
  }

  async function couponAction(id: string, action: "approve" | "reject" | "pause") {
    setBusy(action + "-" + id);
    setError(null);
    const res = await fetch(`/api/coupons/active/${id}`, {
      method: "POST", headers: headers(), body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (data.error) setError(data.error);
    await reload();
    setBusy(null);
  }

  async function saveSettings(patch: Partial<Settings>) {
    if (!settings) return;
    setBusy("settings");
    setError(null);
    const res = await fetch("/api/coupons/settings", {
      method: "PATCH", headers: headers(), body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (data.error) setError(data.error);
    else setSettings(data.settings);
    setBusy(null);
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Tag className="h-6 w-6" />
          <div>
            <h1 className="text-2xl font-bold">Cupons Automáticos</h1>
            <p className="text-sm text-muted-foreground">
              Rotação de cupons em produtos de baixo giro com countdown na PDP
            </p>
          </div>
        </div>
        <Button onClick={() => setEditing({ ...EMPTY_PLAN })}>
          <Plus className="h-4 w-4 mr-2" /> Novo Plano
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="plans">Planos ({plans.filter(p => p.enabled).length})</TabsTrigger>
          <TabsTrigger value="pending">Aguardando aprovação ({pending.length})</TabsTrigger>
          <TabsTrigger value="active">Ativos ({active.length})</TabsTrigger>
          <TabsTrigger value="bandit">Bandit %/R$</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
          <TabsTrigger value="settings"><Settings className="h-3.5 w-3.5 mr-1" /> Configurações</TabsTrigger>
        </TabsList>

        {/* PLANS */}
        <TabsContent value="plans" className="space-y-3">
          {plans.length === 0 && (
            <Card><CardContent className="py-12 text-center text-muted-foreground">
              <p>Nenhum plano configurado.</p>
              <p className="text-xs mt-1">Crie um plano pra que o cron escolha produtos pra promoção.</p>
            </CardContent></Card>
          )}
          {plans.map((p) => (
            <Card key={p.id} className={!p.enabled ? "opacity-50" : ""}>
              <CardContent className="py-4 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{p.name}</span>
                    <Badge variant={p.enabled ? "default" : "secondary"}>{p.enabled ? "Ativo" : "Desabilitado"}</Badge>
                    <Badge variant="outline">{MODE_LABELS[p.mode] || p.mode}</Badge>
                    {p.mode === "smart" && (
                      <Badge variant="outline" className="border-emerald-500/40 text-emerald-500">
                        unit: {p.discount_unit || "pct"}
                      </Badge>
                    )}
                    <Badge variant="outline">{TARGET_LABELS[p.target]}</Badge>
                    {p.require_manual_approval && <Badge variant="outline" className="border-amber-500/40 text-amber-500">Aprovação manual</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {p.discount_min_pct}–{p.discount_max_pct}% · {p.duration_hours}h · max {p.max_active_products} ativos · {p.recurring_cron || "sem cron"}
                  </p>
                </div>
                <div className="flex gap-2">
                  {p.enabled && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => runPlanNow(p.id)}
                      disabled={busy === "run-" + p.id}
                      title="Roda o picker imediatamente para este plano (sem esperar o cron de 06h)"
                    >
                      {busy === "run-" + p.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      ) : (
                        <Play className="h-3.5 w-3.5 mr-1" />
                      )}
                      Rodar agora
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setEditing(p)}>Editar</Button>
                  {p.enabled && (
                    <Button variant="outline" size="sm" onClick={() => disablePlan(p.id)} disabled={busy === "del-" + p.id}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* PENDING */}
        <TabsContent value="pending" className="space-y-3">
          {pending.length === 0 && (
            <Card><CardContent className="py-12 text-center text-muted-foreground">
              <p>Nenhuma proposta pendente.</p>
              <p className="text-xs mt-1">O cron roda diariamente às 09:00 UTC e popula esta lista.</p>
            </CardContent></Card>
          )}
          {pending.map((c) => (
            <Card key={c.id}>
              <CardContent className="py-4 flex items-center justify-between gap-3">
                {c.product_image_url && (
                  <img src={c.product_image_url} alt="" className="w-14 h-14 object-cover rounded border" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{c.product_name || `Produto ${c.product_id}`}</span>
                    <Badge variant="default">{c.discount_pct}% OFF</Badge>
                    <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{c.vnda_coupon_code}</code>
                    {c.product_url && (
                      <a href={c.product_url} target="_blank" rel="noopener" className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
                        ver na loja <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    ID {c.product_id} · vence em {new Date(c.expires_at).toLocaleString("pt-BR")} · proposto {new Date(c.created_at).toLocaleString("pt-BR")}
                    {c.product_price && (
                      <span className="ml-2">· preço {(c.product_sale_price || c.product_price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>
                    )}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="default" size="sm" onClick={() => couponAction(c.id, "approve")} disabled={busy === "approve-" + c.id}>
                    {busy === "approve-" + c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                    Aprovar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => couponAction(c.id, "reject")} disabled={busy === "reject-" + c.id}>
                    <XCircle className="h-3.5 w-3.5 mr-1" /> Rejeitar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ACTIVE */}
        <TabsContent value="active" className="space-y-3">
          {active.length === 0 && (
            <Card><CardContent className="py-12 text-center text-muted-foreground">
              <p>Nenhum cupom ativo no momento.</p>
            </CardContent></Card>
          )}
          {active.map((c) => {
            const v = verifyResults[c.id];
            return (
              <Card key={c.id}>
                <CardContent className="py-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    {c.product_image_url && (
                      <img src={c.product_image_url} alt="" className="w-14 h-14 object-cover rounded border" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{c.product_name || `Produto ${c.product_id}`}</span>
                        <Badge>
                          {c.discount_unit === "brl" && c.discount_value_brl
                            ? `R$ ${c.discount_value_brl} OFF`
                            : `${c.discount_pct}% OFF`}
                        </Badge>
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{c.vnda_coupon_code}</code>
                        {c.product_url && (
                          <a href={c.product_url} target="_blank" rel="noopener" className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
                            ver na loja <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        <Clock className="inline h-3 w-3 mr-1" />
                        Expira {new Date(c.expires_at).toLocaleString("pt-BR")} · ID produto {c.product_id}
                        {c.vnda_discount_id && (
                          <span className="ml-2">· VNDA promo #{c.vnda_discount_id}</span>
                        )}
                        {c.attributed_units > 0 && (
                          <span className="ml-2 text-green-600">· {c.attributed_units} venda(s) · {fmtBRL(c.attributed_revenue)}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => syncCouponAttribution(c.id)}
                        disabled={busy === "sync-" + c.id}
                        title="Re-soma vendas em crm_vendas com este código e atualiza attribution"
                      >
                        {busy === "sync-" + c.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : null}
                        Sync attribution
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => verifyOnVnda(c.id)}
                        disabled={busy === "verify-" + c.id}
                        title="Consulta a VNDA pra confirmar que a promocao esta lá e ativa"
                      >
                        {busy === "verify-" + c.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                        )}
                        Verificar VNDA
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => couponAction(c.id, "pause")} disabled={busy === "pause-" + c.id}>
                        <PauseCircle className="h-3.5 w-3.5 mr-1" /> Pausar
                      </Button>
                    </div>
                  </div>
                  {v && (
                    <div className={`rounded-md border p-2 text-xs flex items-start gap-2 ${
                      v.ok ? "border-green-500/30 bg-green-500/10 text-green-500" : "border-amber-500/30 bg-amber-500/10 text-amber-500"
                    }`}>
                      {v.ok ? <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                      <div className="flex-1">
                        {v.ok ? (
                          <>
                            VNDA confirmou: promo "{v.promotion_name}" {v.promotion_enabled ? "habilitada" : "DESABILITADA"} ·
                            código {v.coupon_code_exists ? "existe" : "NAO ENCONTRADO"}
                            {typeof v.coupon_used_count === "number" && (
                              <span> · usado {v.coupon_used_count}/{v.coupon_uses_per_code ?? "∞"} vezes</span>
                            )}
                          </>
                        ) : (
                          <>Falha: {v.error || "promo ou codigo nao encontrado na VNDA"}</>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* BANDIT */}
        <TabsContent value="bandit" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Bandit %/R$ — qual unidade converte melhor</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Quando o plano está em modo <code>discount_unit=auto</code>, o sistema escolhe entre % e R$ usando epsilon-greedy 80/20.
                  Cold start exige no mínimo 10 attempts em cada arm antes de começar a explotar.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={recomputeBandit} disabled={busy === "bandit-recompute"}>
                {busy === "bandit-recompute" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Recalcular agora
              </Button>
            </CardHeader>
            <CardContent>
              {!banditStats || (banditStats.pct_attempts + banditStats.brl_attempts === 0) ? (
                <div className="text-center text-muted-foreground py-6">
                  Sem dados ainda. Crie cupons em modo smart e aguarde a atribuição rodar.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { unit: "pct", label: "Percentual (%)", attempts: banditStats.pct_attempts, revenue: banditStats.pct_revenue, units: banditStats.pct_units },
                    { unit: "brl", label: "Reais (R$)", attempts: banditStats.brl_attempts, revenue: banditStats.brl_revenue, units: banditStats.brl_units },
                  ].map((arm) => {
                    const rpa = arm.attempts > 0 ? arm.revenue / arm.attempts : 0;
                    const otherRpa = arm.unit === "pct"
                      ? (banditStats.brl_attempts > 0 ? banditStats.brl_revenue / banditStats.brl_attempts : 0)
                      : (banditStats.pct_attempts > 0 ? banditStats.pct_revenue / banditStats.pct_attempts : 0);
                    const winning = rpa > otherRpa && arm.attempts >= 10 && (arm.unit === "pct" ? banditStats.brl_attempts >= 10 : banditStats.pct_attempts >= 10);
                    return (
                      <div key={arm.unit} className={`rounded-lg border p-4 ${winning ? "border-green-500/40 bg-green-500/5" : ""}`}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-sm font-medium">{arm.label}</span>
                          {winning && <Badge variant="default" className="bg-green-500/20 text-green-600 border-green-500/40">Vencedor</Badge>}
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Cupons emitidos</span>
                            <span className="font-medium">{arm.attempts}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Vendas atribuídas</span>
                            <span className="font-medium">{arm.units}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Receita atribuída</span>
                            <span className="font-medium">{fmtBRL(arm.revenue)}</span>
                          </div>
                          <div className="flex justify-between text-sm border-t pt-2 mt-2">
                            <span className="text-muted-foreground">Receita / cupom</span>
                            <span className="font-bold">{fmtBRL(rpa)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {banditStats?.last_recomputed_at && (
                <p className="text-xs text-muted-foreground mt-4">
                  Última recomputação: {new Date(banditStats.last_recomputed_at).toLocaleString("pt-BR")}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* HISTORY */}
        <TabsContent value="history" className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Últimas 200 ações (ordenadas por mais recente). Inclui crons, aprovações, calls VNDA, atribuições.
          </p>
          {auditEntries.length === 0 && (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Sem registros ainda.</CardContent></Card>
          )}
          {auditEntries.map((e) => (
            <Card key={e.id}>
              <CardContent className="py-3 flex items-start justify-between gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={e.action.includes("fail") || e.action === "rejected" ? "destructive" : e.action.includes("ok") || e.action === "approved" ? "default" : "secondary"}>
                      {e.action}
                    </Badge>
                    {e.product_id && <code className="text-xs bg-muted px-1 rounded">prod {e.product_id}</code>}
                    <span className="text-xs text-muted-foreground">por {e.actor || "system"}</span>
                  </div>
                  {e.error_message && (
                    <p className="text-xs text-red-500 mt-1">{e.error_message}</p>
                  )}
                  {e.details && Object.keys(e.details).length > 0 && (
                    <details className="mt-1">
                      <summary className="text-xs text-muted-foreground cursor-pointer">detalhes</summary>
                      <pre className="text-[10px] bg-muted/40 rounded p-2 mt-1 overflow-x-auto">
                        {JSON.stringify(e.details, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(e.created_at).toLocaleString("pt-BR")}
                </span>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* SETTINGS */}
        <TabsContent value="settings" className="space-y-4">
          {settings && (
            <Card>
              <CardHeader><CardTitle className="text-base">Travas globais do workspace</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Cap máximo de desconto (%)</Label>
                    <Input
                      type="number" min={1} max={80}
                      value={settings.global_max_discount_pct}
                      onChange={(e) => setSettings({ ...settings, global_max_discount_pct: Number(e.target.value) })}
                    />
                    <p className="text-xs text-muted-foreground">Nenhum plano pode passar disto. Hoje: {settings.global_max_discount_pct}%.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Máximo de cupons ativos simultâneos</Label>
                    <Input
                      type="number" min={1} max={200}
                      value={settings.global_max_active_coupons}
                      onChange={(e) => setSettings({ ...settings, global_max_active_coupons: Number(e.target.value) })}
                    />
                    <p className="text-xs text-muted-foreground">Soma de todos os planos no workspace.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>TTL de aprovações pendentes (h)</Label>
                    <Input
                      type="number" min={1} max={168}
                      value={settings.pending_approval_ttl_hours}
                      onChange={(e) => setSettings({ ...settings, pending_approval_ttl_hours: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Usos por código (default)</Label>
                    <Input
                      type="number" min={1}
                      value={settings.default_uses_per_code}
                      onChange={(e) => setSettings({ ...settings, default_uses_per_code: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Usos por usuário (default)</Label>
                    <Input
                      type="number" min={1}
                      value={settings.default_uses_per_user}
                      onChange={(e) => setSettings({ ...settings, default_uses_per_user: Number(e.target.value) })}
                    />
                  </div>
                  <div className="flex items-center justify-between space-x-2 pt-6">
                    <Label>Cupons cumulativos com outras promos</Label>
                    <Switch
                      checked={settings.cumulative_with_other_promos}
                      onCheckedChange={(v) => setSettings({ ...settings, cumulative_with_other_promos: v })}
                    />
                  </div>
                </div>
                <Button onClick={() => saveSettings(settings)} disabled={busy === "settings"}>
                  {busy === "settings" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Salvar travas
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* PLAN EDITOR */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar plano" : "Novo plano"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Ex: Cupom flash semanal" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Modo</Label>
                  <Select
                    value={editing.mode}
                    onValueChange={(v) => {
                      const next: Partial<Plan> = { ...editing, mode: v as Plan["mode"] };
                      // Smart mode forces auto-approve + sane defaults
                      if (v === "smart") {
                        next.require_manual_approval = false;
                        if (!next.discount_unit) next.discount_unit = "auto";
                      }
                      setEditing(next);
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="smart">Smart (totalmente automático) ⚡</SelectItem>
                      <SelectItem value="recurring">Recorrente (cron)</SelectItem>
                      <SelectItem value="one_shot">Pontual (não renova)</SelectItem>
                    </SelectContent>
                  </Select>
                  {editing.mode === "smart" && (
                    <p className="text-[11px] text-emerald-500">
                      Auto-aprova, escolhe % vs R$ via bandit, ajusta por demanda. Roda 1×/24h.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Alvo</Label>
                  <Select value={editing.target} onValueChange={(v) => setEditing({ ...editing, target: v as Plan["target"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low_cvr_high_views">Muito visto + pouca conversão</SelectItem>
                      <SelectItem value="tier_b">Tier B</SelectItem>
                      <SelectItem value="tier_c">Tier C (cauda longa)</SelectItem>
                      <SelectItem value="manual">IDs manuais</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo de desconto</Label>
                  <Select
                    value={editing.discount_unit || "pct"}
                    onValueChange={(v) => setEditing({ ...editing, discount_unit: v as Plan["discount_unit"] })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(DISCOUNT_UNIT_LABELS).map(([k, label]) => (
                        <SelectItem key={k} value={k}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {editing.discount_unit === "auto" && (
                    <p className="text-[11px] text-muted-foreground">Sistema testa % e R$, fica com o vencedor.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Cooldown (dias)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={90}
                    value={editing.cooldown_days ?? 7}
                    onChange={(e) => setEditing({ ...editing, cooldown_days: Number(e.target.value) })}
                  />
                  <p className="text-[11px] text-muted-foreground">Mesmo produto não recebe novo cupom antes desse prazo.</p>
                </div>
              </div>
              {editing.target === "manual" && (
                <div className="space-y-2">
                  <Label>IDs dos produtos (separados por vírgula)</Label>
                  <Input
                    value={(editing.manual_product_ids || []).join(",")}
                    onChange={(e) => setEditing({ ...editing, manual_product_ids: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })}
                    placeholder="1290, 1356, 681"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Desconto mín (%)</Label>
                  <Input type="number" min={1} max={80} value={editing.discount_min_pct ?? 10}
                    onChange={(e) => setEditing({ ...editing, discount_min_pct: Number(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <Label>Desconto máx (%)</Label>
                  <Input type="number" min={1} max={80} value={editing.discount_max_pct ?? 20}
                    onChange={(e) => setEditing({ ...editing, discount_max_pct: Number(e.target.value) })} />
                  {settings && (editing.discount_max_pct ?? 0) > settings.global_max_discount_pct && (
                    <p className="text-xs text-red-500">⚠ Excede o cap do workspace ({settings.global_max_discount_pct}%) — será bloqueado ao salvar</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Duração (h)</Label>
                  <Input type="number" min={1} max={168} value={editing.duration_hours ?? 48}
                    onChange={(e) => setEditing({ ...editing, duration_hours: Number(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <Label>Máx ativos (este plano)</Label>
                  <Input type="number" min={1} max={50} value={editing.max_active_products ?? 5}
                    onChange={(e) => setEditing({ ...editing, max_active_products: Number(e.target.value) })} />
                </div>
              </div>
              {editing.mode === "recurring" && (
                <div className="space-y-2">
                  <Label>Cron expression (UTC)</Label>
                  <Input value={editing.recurring_cron || ""} onChange={(e) => setEditing({ ...editing, recurring_cron: e.target.value })} placeholder="0 9 * * 1 (toda segunda 9h UTC)" />
                </div>
              )}
              {editing.mode !== "smart" && (
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Aprovação manual</Label>
                    <p className="text-xs text-muted-foreground">Quando ligado, cron só sugere — você aprova individualmente</p>
                  </div>
                  <Switch
                    checked={editing.require_manual_approval !== false}
                    onCheckedChange={(v) => setEditing({ ...editing, require_manual_approval: v })}
                  />
                </div>
              )}
              {editing.mode === "smart" && (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-600">
                  Modo smart: aprovação manual é desligada automaticamente. Cupons vão direto pra VNDA.
                </div>
              )}
              <div className="space-y-2">
                <Label>Texto do badge</Label>
                <Input value={editing.badge_template || ""} onChange={(e) => setEditing({ ...editing, badge_template: e.target.value })} />
                <p className="text-xs text-muted-foreground">Use {"{discount}"}, {"{coupon}"}, {"{countdown}"} como placeholders.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Cor de fundo</Label>
                  <div className="flex gap-2">
                    <input type="color" value={editing.badge_bg_color || "#dc2626"}
                      onChange={(e) => setEditing({ ...editing, badge_bg_color: e.target.value })}
                      className="w-8 h-8 rounded border cursor-pointer" />
                    <Input value={editing.badge_bg_color || ""} onChange={(e) => setEditing({ ...editing, badge_bg_color: e.target.value })} className="font-mono text-xs" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Cor do texto</Label>
                  <div className="flex gap-2">
                    <input type="color" value={editing.badge_text_color || "#ffffff"}
                      onChange={(e) => setEditing({ ...editing, badge_text_color: e.target.value })}
                      className="w-8 h-8 rounded border cursor-pointer" />
                    <Input value={editing.badge_text_color || ""} onChange={(e) => setEditing({ ...editing, badge_text_color: e.target.value })} className="font-mono text-xs" />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
                <Button onClick={savePlan} disabled={busy === "save"}>
                  {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Salvar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

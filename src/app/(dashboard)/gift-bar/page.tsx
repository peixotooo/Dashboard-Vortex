"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Gift,
  Save,
  Loader2,
  Check,
  Key,
  ExternalLink,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";
import Link from "next/link";

// --- Types ---

interface GiftBarStep {
  label: string;
  icon: string;
  threshold: number;
  modal_title?: string;
  modal_body?: string;
}

interface ProductBenefit {
  icon: string;
  title: string;
  link_label?: string;
  modal_title?: string;
  modal_body?: string;
}

interface GiftBarConfig {
  id?: string;
  workspace_id?: string;
  enabled: boolean;
  threshold: number;
  gift_name: string;
  gift_description: string;
  gift_image_url: string;
  message_progress: string;
  message_achieved: string;
  message_empty: string;
  message_next_step: string;
  message_all_achieved: string;
  bar_color: string;
  bar_bg_color: string;
  text_color: string;
  bg_color: string;
  achieved_bg_color: string;
  achieved_text_color: string;
  font_size: string;
  bar_height: string;
  position: string;
  show_on_pages: string[];
  steps: GiftBarStep[];
  show_product_benefits: boolean;
  product_benefits: ProductBenefit[];
  product_benefits_title: string;
  product_benefits_anchor: string;
}

const ICON_OPTIONS = [
  { value: "truck", label: "Caminhão (Frete)" },
  { value: "gift", label: "Brinde" },
  { value: "star", label: "Estrela" },
  { value: "heart", label: "Coração" },
  { value: "percent", label: "Desconto" },
  { value: "sparkles", label: "Sparkles" },
  { value: "bag", label: "Sacola" },
  { value: "crown", label: "Coroa" },
  { value: "medal", label: "Medalha" },
  { value: "shirt", label: "Camiseta" },
  { value: "info", label: "Informação" },
];

function StepIcon({ name }: { name: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style: { width: "60%", height: "60%" },
  };
  switch (name) {
    case "truck":
      return (
        <svg {...common}>
          <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
          <path d="M15 18H9" />
          <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
          <circle cx="17" cy="18" r="2" />
          <circle cx="7" cy="18" r="2" />
        </svg>
      );
    case "gift":
      return (
        <svg {...common}>
          <rect x="3" y="8" width="18" height="4" rx="1" />
          <path d="M12 8v13" />
          <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
          <path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" />
        </svg>
      );
    case "star":
      return (
        <svg {...common}>
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
    case "heart":
      return (
        <svg {...common}>
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" />
        </svg>
      );
    case "percent":
      return (
        <svg {...common}>
          <line x1="19" y1="5" x2="5" y2="19" />
          <circle cx="6.5" cy="6.5" r="2.5" />
          <circle cx="17.5" cy="17.5" r="2.5" />
        </svg>
      );
    case "sparkles":
      return (
        <svg {...common}>
          <path d="M12 3l1.9 5.7L19.6 10.6 13.9 12.5 12 18.2l-1.9-5.7L4.4 10.6 10.1 8.7z" />
          <path d="M19 3v4" />
          <path d="M21 5h-4" />
        </svg>
      );
    case "bag":
      return (
        <svg {...common}>
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
      );
    case "crown":
      return (
        <svg {...common}>
          <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
        </svg>
      );
    case "medal":
      return (
        <svg {...common}>
          <path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15" />
          <path d="M11 12 5.12 2.2" />
          <path d="M13 12l5.88-9.8" />
          <circle cx="12" cy="17" r="5" />
        </svg>
      );
    case "shirt":
      return (
        <svg {...common}>
          <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />
        </svg>
      );
    case "info":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
    default:
      return <span style={{ fontSize: 16 }}>🎁</span>;
  }
}

const DEFAULT_CONFIG: GiftBarConfig = {
  enabled: false,
  threshold: 299,
  gift_name: "brinde exclusivo",
  gift_description: "",
  gift_image_url: "",
  message_progress: "Faltam R$ {remaining} para ganhar {gift}!",
  message_achieved: "Parabéns! Você ganhou {gift}!",
  message_empty: "Adicione R$ {threshold} em produtos e ganhe {gift}!",
  message_next_step: "Faltam R$ {gap} para o próximo {next_label}!",
  message_all_achieved: "Você desbloqueou todos os mimos!",
  bar_color: "#10b981",
  bar_bg_color: "#e5e7eb",
  text_color: "#1f2937",
  bg_color: "#ffffff",
  achieved_bg_color: "#ecfdf5",
  achieved_text_color: "#065f46",
  font_size: "14px",
  bar_height: "8px",
  position: "top",
  show_on_pages: ["all"],
  steps: [],
  show_product_benefits: false,
  product_benefits: [],
  product_benefits_title: "Nossos benefícios",
  product_benefits_anchor: "",
};

function mergeWithDefaults(raw: Partial<GiftBarConfig>): GiftBarConfig {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    steps: Array.isArray(raw.steps) ? raw.steps : [],
    show_on_pages: Array.isArray(raw.show_on_pages)
      ? raw.show_on_pages
      : ["all"],
    product_benefits: Array.isArray(raw.product_benefits)
      ? raw.product_benefits
      : [],
    product_benefits_title:
      raw.product_benefits_title || DEFAULT_CONFIG.product_benefits_title,
    product_benefits_anchor: raw.product_benefits_anchor ?? "",
    show_product_benefits: raw.show_product_benefits === true,
    message_next_step:
      raw.message_next_step || DEFAULT_CONFIG.message_next_step,
    message_all_achieved:
      raw.message_all_achieved || DEFAULT_CONFIG.message_all_achieved,
  };
}

const FREE_SHIPPING_TABLE_TEMPLATE =`<p>Frete gr&aacute;tis acima do valor m&iacute;nimo para cada regi&atilde;o:</p>
<table>
  <thead>
    <tr><th>Regi&atilde;o</th><th>Valor m&iacute;nimo</th></tr>
  </thead>
  <tbody>
    <tr><td>Sudeste</td><td>R$ 299</td></tr>
    <tr><td>Sul</td><td>R$ 349</td></tr>
    <tr><td>Centro-Oeste</td><td>R$ 399</td></tr>
    <tr><td>Nordeste</td><td>R$ 449</td></tr>
    <tr><td>Norte</td><td>R$ 499</td></tr>
  </tbody>
</table>`;

const PAGE_OPTIONS = [
  { value: "all", label: "Todas as páginas" },
  { value: "home", label: "Home" },
  { value: "product", label: "Produto" },
  { value: "category", label: "Categoria" },
  { value: "cart", label: "Carrinho" },
];

// --- Component ---

export default function GiftBarPage() {
  const { workspace } = useWorkspace();
  const [config, setConfig] = useState<GiftBarConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [previewCart, setPreviewCart] = useState(150);

  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "x-workspace-id": workspace?.id || "",
    }),
    [workspace?.id]
  );

  const loadConfig = useCallback(async () => {
    if (!workspace?.id) return;
    try {
      const res = await fetch("/api/gift-bar/config", { headers: headers() });
      const data = await res.json();
      if (data.config) {
        setConfig(mergeWithDefaults(data.config));
      }
    } catch (err) {
      console.error("Failed to load gift bar config:", err);
    }
  }, [workspace?.id, headers]);

  const loadApiKeys = useCallback(async () => {
    if (!workspace?.id) return;
    try {
      const res = await fetch("/api/shelves/api-keys", { headers: headers() });
      const data = await res.json();
      setHasApiKey((data.keys || []).length > 0);
    } catch {
      // ignore
    }
  }, [workspace?.id, headers]);

  useEffect(() => {
    if (workspace?.id) {
      Promise.all([loadConfig(), loadApiKeys()]).finally(() =>
        setLoading(false)
      );
    }
  }, [workspace?.id, loadConfig, loadApiKeys]);

  async function handleSave() {
    if (!workspace?.id) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/gift-bar/config", {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (data.config) {
        setConfig(mergeWithDefaults(data.config));
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      console.error("Failed to save gift bar config:", err);
    } finally {
      setSaving(false);
    }
  }

  function updateConfig(partial: Partial<GiftBarConfig>) {
    setConfig((prev) => ({ ...prev, ...partial }));
  }

  function updateStep(index: number, partial: Partial<GiftBarStep>) {
    setConfig((prev) => {
      const next = prev.steps.slice();
      next[index] = { ...next[index], ...partial };
      return { ...prev, steps: next };
    });
  }

  function addStep() {
    setConfig((prev) => ({
      ...prev,
      steps: [
        ...prev.steps,
        { label: "Novo passo", icon: "gift", threshold: 0 },
      ],
    }));
  }

  function removeStep(index: number) {
    setConfig((prev) => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== index),
    }));
  }

  function moveStep(index: number, dir: -1 | 1) {
    setConfig((prev) => {
      const next = prev.steps.slice();
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...prev, steps: next };
    });
  }

  function switchToSingle() {
    if (config.steps.length === 0) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Trocar para Brinde único vai remover as etapas configuradas. Continuar?"
      )
    ) {
      return;
    }
    setConfig((prev) => ({ ...prev, steps: [] }));
  }

  function switchToMultistep() {
    if (config.steps.length === 0) {
      addStep();
    }
  }

  function applyBulkingPreset() {
    setConfig((prev) => ({
      ...prev,
      message_next_step: "Faltam R$ {gap} para o próximo {next_label}!",
      message_all_achieved: "Você desbloqueou todos os mimos!",
      steps: [
        {
          label: "Frete Grátis",
          icon: "truck",
          threshold: 299,
          modal_title: "Frete grátis por região",
          modal_body: FREE_SHIPPING_TABLE_TEMPLATE,
        },
        { label: "Brinde", icon: "gift", threshold: 399 },
        { label: "Brinde", icon: "gift", threshold: 499 },
        { label: "Look", icon: "star", threshold: 599 },
      ],
    }));
  }

  function updateBenefit(index: number, partial: Partial<ProductBenefit>) {
    setConfig((prev) => {
      const next = prev.product_benefits.slice();
      next[index] = { ...next[index], ...partial };
      return { ...prev, product_benefits: next };
    });
  }

  function addBenefit() {
    setConfig((prev) => ({
      ...prev,
      product_benefits: [
        ...prev.product_benefits,
        { icon: "info", title: "Novo benefício" },
      ],
    }));
  }

  function removeBenefit(index: number) {
    setConfig((prev) => ({
      ...prev,
      product_benefits: prev.product_benefits.filter((_, i) => i !== index),
    }));
  }

  function moveBenefit(index: number, dir: -1 | 1) {
    setConfig((prev) => {
      const next = prev.product_benefits.slice();
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...prev, product_benefits: next };
    });
  }

  function applyBulkingBenefitsPreset() {
    setConfig((prev) => ({
      ...prev,
      show_product_benefits: true,
      product_benefits_title: "Nossos benefícios",
      product_benefits: [
        {
          icon: "truck",
          title: "Frete grátis a partir de R$ 299*",
          link_label: "Confira por região.",
          modal_title: "Frete grátis por região",
          modal_body: FREE_SHIPPING_TABLE_TEMPLATE,
        },
        {
          icon: "percent",
          title: "10% de Cashback na próxima compra.",
          link_label: "Saiba mais sobre o cashback.",
          modal_title: "Cashback Bulking",
          modal_body:
            "<p>A cada compra você recebe <strong>10% de cashback</strong> que vira crédito para usar na próxima.</p><p>O crédito é liberado após o prazo de troca e não acumula com outros descontos.</p>",
        },
        {
          icon: "medal",
          title: "Melhor custo benefício do Brasil.",
          link_label: "Entenda o motivo.",
          modal_title: "Por que somos o melhor custo benefício",
          modal_body:
            "<p>Tecidos premium, modelagem testada em performance e produção própria — o que garante qualidade superior por um preço menor que o mercado.</p>",
        },
        {
          icon: "shirt",
          title: "Mais cuidado, mais durabilidade.",
          link_label: "Veja como conservar seu produto.",
          modal_title: "Como conservar seu produto",
          modal_body:
            "<p>Lave do avesso, em água fria, com sabão neutro.</p><p>Não use alvejante, não passe ferro nas estampas e seque à sombra.</p>",
        },
        {
          icon: "bag",
          title: "A primeira troca é fácil e gratuita.",
          link_label: "Confira as opções de troca aqui.",
          modal_title: "Política de trocas",
          modal_body:
            "<p>Você tem até 30 dias após o recebimento para solicitar a troca pelo site.</p><p>A primeira troca é por nossa conta. Trocas seguintes do mesmo pedido têm o frete pago pelo cliente.</p>",
        },
      ],
    }));
  }

  function togglePage(page: string) {
    setConfig((prev) => {
      const current = prev.show_on_pages;
      if (page === "all") {
        return { ...prev, show_on_pages: ["all"] };
      }
      let next = current.filter((p) => p !== "all");
      if (next.includes(page)) {
        next = next.filter((p) => p !== page);
      } else {
        next.push(page);
      }
      if (next.length === 0) next = ["all"];
      return { ...prev, show_on_pages: next };
    });
  }

  // --- Preview helpers ---

  function interpolateMessage(template: string, cartTotal: number) {
    const remaining = Math.max(config.threshold - cartTotal, 0);
    return template
      .replace(/\{remaining\}/g, formatBRL(remaining))
      .replace(/\{threshold\}/g, formatBRL(config.threshold))
      .replace(/\{gift\}/g, config.gift_name)
      .replace(/\{total\}/g, formatBRL(cartTotal));
  }

  function formatBRL(value: number) {
    return value.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function getPreviewMessage(cartTotal: number) {
    if (cartTotal <= 0) return interpolateMessage(config.message_empty, 0);
    if (cartTotal >= config.threshold)
      return interpolateMessage(config.message_achieved, cartTotal);
    return interpolateMessage(config.message_progress, cartTotal);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isMultistep = config.steps.length > 0;
  const sortedSteps = [...config.steps].sort(
    (a, b) => Number(a.threshold) - Number(b.threshold)
  );
  const maxStepThreshold =
    sortedSteps.length > 0
      ? Number(sortedSteps[sortedSteps.length - 1].threshold) || 1
      : 1;
  const pct = isMultistep
    ? Math.min((previewCart / maxStepThreshold) * 100, 100)
    : Math.min((previewCart / config.threshold) * 100, 100);
  const achieved = previewCart >= config.threshold;
  const nextStep = sortedSteps.find(
    (s) => previewCart < Number(s.threshold)
  );

  function getMultistepMessage(cartTotal: number): string {
    if (cartTotal <= 0) {
      return (config.message_empty || "")
        .replace(
          /\{threshold\}/g,
          formatBRL(Number(sortedSteps[0]?.threshold) || 0)
        )
        .replace(/\{gift\}/g, sortedSteps[0]?.label || "");
    }
    if (!nextStep) return config.message_all_achieved || "";
    const gap = Math.max(Number(nextStep.threshold) - cartTotal, 0);
    return (config.message_next_step || "")
      .replace(/\{gap\}/g, formatBRL(gap))
      .replace(/\{next_label\}/g, nextStep.label || "")
      .replace(
        /\{next_threshold\}/g,
        formatBRL(Number(nextStep.threshold))
      )
      .replace(/\{total\}/g, formatBRL(cartTotal));
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Gift className="h-6 w-6" />
          <div>
            <h1 className="text-2xl font-bold">Régua de Brinde</h1>
            <p className="text-sm text-muted-foreground">
              Barra de progresso que incentiva o aumento do ticket médio
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              checked={config.enabled}
              onCheckedChange={(v) => updateConfig({ enabled: v })}
            />
            <Badge variant={config.enabled ? "default" : "secondary"}>
              {config.enabled ? "Ativo" : "Inativo"}
            </Badge>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : saved ? (
              <Check className="h-4 w-4 mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {saved ? "Salvo!" : "Salvar"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">Configuração</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="install">Instalação</TabsTrigger>
        </TabsList>

        {/* ======================== TAB: CONFIG ======================== */}
        <TabsContent value="config" className="space-y-6">
          {/* Mode + Display */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Modo da Régua</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={switchToSingle}
                  className={`rounded-lg border-2 p-4 text-left transition ${
                    !isMultistep
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="font-medium text-sm">Brinde único</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Um único marco. Ex: &quot;Faltam R$ 50 para ganhar
                    necessaire&quot;.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={switchToMultistep}
                  className={`rounded-lg border-2 p-4 text-left transition ${
                    isMultistep
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="font-medium text-sm">
                    Multi-etapas (timeline)
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Vários marcos com ícones (Frete Grátis → Brinde → Brinde →
                    Look).
                  </p>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="space-y-2">
                  <Label>Posição</Label>
                  <Select
                    value={config.position}
                    onValueChange={(v) => updateConfig({ position: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="top">Topo da página</SelectItem>
                      <SelectItem value="bottom">Rodapé fixo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Exibir em</Label>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {PAGE_OPTIONS.map((p) => (
                      <Badge
                        key={p.value}
                        variant={
                          config.show_on_pages.includes(p.value)
                            ? "default"
                            : "outline"
                        }
                        className="cursor-pointer"
                        onClick={() => togglePage(p.value)}
                      >
                        {p.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* SINGLE MODE: Brinde + messages */}
          {!isMultistep && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Brinde único</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Valor mínimo (R$)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={config.threshold}
                      onChange={(e) =>
                        updateConfig({
                          threshold: parseFloat(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Nome do brinde</Label>
                    <Input
                      value={config.gift_name}
                      onChange={(e) =>
                        updateConfig({ gift_name: e.target.value })
                      }
                      placeholder="Ex: necessaire premium"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Descrição (opcional)</Label>
                  <Textarea
                    value={config.gift_description}
                    onChange={(e) =>
                      updateConfig({ gift_description: e.target.value })
                    }
                    placeholder="Descrição curta do brinde"
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label>URL da imagem (opcional)</Label>
                  <Input
                    value={config.gift_image_url}
                    onChange={(e) =>
                      updateConfig({ gift_image_url: e.target.value })
                    }
                    placeholder="https://cdn.vnda.com.br/..."
                  />
                </div>

                <div className="border-t pt-4 mt-2 space-y-4">
                  <p className="text-xs text-muted-foreground">
                    Mensagens — placeholders:{" "}
                    <code className="bg-muted px-1 rounded">{"{gift}"}</code>{" "}
                    <code className="bg-muted px-1 rounded">
                      {"{remaining}"}
                    </code>{" "}
                    <code className="bg-muted px-1 rounded">
                      {"{threshold}"}
                    </code>{" "}
                    <code className="bg-muted px-1 rounded">{"{total}"}</code>
                  </p>
                  <div className="space-y-2">
                    <Label>Carrinho vazio</Label>
                    <Input
                      value={config.message_empty}
                      onChange={(e) =>
                        updateConfig({ message_empty: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Em progresso</Label>
                    <Input
                      value={config.message_progress}
                      onChange={(e) =>
                        updateConfig({ message_progress: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Brinde conquistado</Label>
                    <Input
                      value={config.message_achieved}
                      onChange={(e) =>
                        updateConfig({ message_achieved: e.target.value })
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* MULTISTEP MODE: Steps editor + messages */}
          {isMultistep && (
            <>
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-base">Etapas</CardTitle>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={applyBulkingPreset}
                      >
                        Preset Bulking
                      </Button>
                      <Button variant="outline" size="sm" onClick={addStep}>
                        <Plus className="h-4 w-4 mr-1" />
                        Nova etapa
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {config.steps.map((step, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border p-4 space-y-3 bg-muted/30"
                  >
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="font-mono">
                        Etapa #{idx + 1}
                      </Badge>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveStep(idx, -1)}
                          disabled={idx === 0}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveStep(idx, 1)}
                          disabled={idx === config.steps.length - 1}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeStep(idx)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="space-y-2">
                        <Label>Rótulo</Label>
                        <Input
                          value={step.label}
                          onChange={(e) =>
                            updateStep(idx, { label: e.target.value })
                          }
                          placeholder="ex: Frete Grátis"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Ícone</Label>
                        <Select
                          value={step.icon}
                          onValueChange={(v) => updateStep(idx, { icon: v })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ICON_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Valor mínimo (R$)</Label>
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={step.threshold}
                          onChange={(e) =>
                            updateStep(idx, {
                              threshold: parseFloat(e.target.value) || 0,
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>
                        Modal (opcional){" "}
                        <span className="text-xs text-muted-foreground font-normal">
                          — quando preenchido, adiciona asterisco clicável após o rótulo
                        </span>
                      </Label>
                      <Input
                        value={step.modal_title || ""}
                        onChange={(e) =>
                          updateStep(idx, { modal_title: e.target.value })
                        }
                        placeholder="Título do modal (ex: Frete grátis por região)"
                      />
                      <Textarea
                        value={step.modal_body || ""}
                        onChange={(e) =>
                          updateStep(idx, { modal_body: e.target.value })
                        }
                        placeholder="Conteúdo HTML — pode incluir <table>, <p>, <strong>, etc."
                        rows={6}
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Mensagens (multi-etapas)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    Placeholders:{" "}
                    <code className="bg-muted px-1 rounded">{"{gap}"}</code>{" "}
                    <code className="bg-muted px-1 rounded">
                      {"{next_label}"}
                    </code>{" "}
                    <code className="bg-muted px-1 rounded">
                      {"{next_threshold}"}
                    </code>{" "}
                    <code className="bg-muted px-1 rounded">{"{total}"}</code>
                  </p>
                  <div className="space-y-2">
                    <Label>Carrinho vazio</Label>
                    <Input
                      value={config.message_empty}
                      onChange={(e) =>
                        updateConfig({ message_empty: e.target.value })
                      }
                      placeholder="Adicione produtos para começar a desbloquear mimos"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Próximo passo</Label>
                    <Input
                      value={config.message_next_step}
                      onChange={(e) =>
                        updateConfig({ message_next_step: e.target.value })
                      }
                      placeholder="Faltam R$ {gap} para o próximo {next_label}!"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Todos os passos atingidos</Label>
                    <Input
                      value={config.message_all_achieved}
                      onChange={(e) =>
                        updateConfig({ message_all_achieved: e.target.value })
                      }
                      placeholder="Você desbloqueou todos os mimos!"
                    />
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* Appearance */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Aparência</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Cor da barra</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={config.bar_color}
                      onChange={(e) =>
                        updateConfig({ bar_color: e.target.value })
                      }
                      className="w-8 h-8 rounded border cursor-pointer"
                    />
                    <Input
                      value={config.bar_color}
                      onChange={(e) =>
                        updateConfig({ bar_color: e.target.value })
                      }
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Fundo da barra</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={config.bar_bg_color}
                      onChange={(e) =>
                        updateConfig({ bar_bg_color: e.target.value })
                      }
                      className="w-8 h-8 rounded border cursor-pointer"
                    />
                    <Input
                      value={config.bar_bg_color}
                      onChange={(e) =>
                        updateConfig({ bar_bg_color: e.target.value })
                      }
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Cor do texto</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={config.text_color}
                      onChange={(e) =>
                        updateConfig({ text_color: e.target.value })
                      }
                      className="w-8 h-8 rounded border cursor-pointer"
                    />
                    <Input
                      value={config.text_color}
                      onChange={(e) =>
                        updateConfig({ text_color: e.target.value })
                      }
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Fundo normal</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={config.bg_color}
                      onChange={(e) =>
                        updateConfig({ bg_color: e.target.value })
                      }
                      className="w-8 h-8 rounded border cursor-pointer"
                    />
                    <Input
                      value={config.bg_color}
                      onChange={(e) =>
                        updateConfig({ bg_color: e.target.value })
                      }
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Fundo conquistado</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={config.achieved_bg_color}
                      onChange={(e) =>
                        updateConfig({ achieved_bg_color: e.target.value })
                      }
                      className="w-8 h-8 rounded border cursor-pointer"
                    />
                    <Input
                      value={config.achieved_bg_color}
                      onChange={(e) =>
                        updateConfig({ achieved_bg_color: e.target.value })
                      }
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Texto conquistado</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={config.achieved_text_color}
                      onChange={(e) =>
                        updateConfig({ achieved_text_color: e.target.value })
                      }
                      className="w-8 h-8 rounded border cursor-pointer"
                    />
                    <Input
                      value={config.achieved_text_color}
                      onChange={(e) =>
                        updateConfig({ achieved_text_color: e.target.value })
                      }
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Altura da barra</Label>
                  <Select
                    value={config.bar_height}
                    onValueChange={(v) => updateConfig({ bar_height: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="4px">Fina (4px)</SelectItem>
                      <SelectItem value="6px">Média (6px)</SelectItem>
                      <SelectItem value="8px">Grossa (8px)</SelectItem>
                      <SelectItem value="10px">Extra (10px)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Tamanho da fonte</Label>
                  <Select
                    value={config.font_size}
                    onValueChange={(v) => updateConfig({ font_size: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="12px">Pequena (12px)</SelectItem>
                      <SelectItem value="14px">Média (14px)</SelectItem>
                      <SelectItem value="16px">Grande (16px)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Product page benefits */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-base">
                  Benefícios na página de produto
                </CardTitle>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={config.show_product_benefits}
                    onCheckedChange={(v) =>
                      updateConfig({ show_product_benefits: v })
                    }
                  />
                  <Badge
                    variant={
                      config.show_product_benefits ? "default" : "secondary"
                    }
                  >
                    {config.show_product_benefits ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Lista de benefícios renderizada abaixo do botão Comprar nas
                páginas de produto. Cada benefício pode ter um link &quot;saiba
                mais&quot; que abre um modal.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Título do bloco</Label>
                  <Input
                    value={config.product_benefits_title}
                    onChange={(e) =>
                      updateConfig({ product_benefits_title: e.target.value })
                    }
                    placeholder="Nossos benefícios"
                  />
                </div>
                <div className="space-y-2">
                  <Label>
                    Seletor CSS de ancoragem{" "}
                    <span className="text-xs text-muted-foreground font-normal">
                      (opcional)
                    </span>
                  </Label>
                  <Input
                    value={config.product_benefits_anchor}
                    onChange={(e) =>
                      updateConfig({
                        product_benefits_anchor: e.target.value,
                      })
                    }
                    placeholder=".product-buy"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={applyBulkingBenefitsPreset}
                >
                  Preset Bulking
                </Button>
                <Button variant="outline" size="sm" onClick={addBenefit}>
                  <Plus className="h-4 w-4 mr-1" />
                  Novo benefício
                </Button>
              </div>

              {config.product_benefits.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Nenhum benefício configurado. Use o preset Bulking ou
                  adicione um novo.
                </p>
              ) : (
                config.product_benefits.map((benefit, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border p-4 space-y-3 bg-muted/30"
                  >
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="font-mono">
                        Benefício #{idx + 1}
                      </Badge>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveBenefit(idx, -1)}
                          disabled={idx === 0}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveBenefit(idx, 1)}
                          disabled={
                            idx === config.product_benefits.length - 1
                          }
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeBenefit(idx)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="space-y-2">
                        <Label>Ícone</Label>
                        <Select
                          value={benefit.icon}
                          onValueChange={(v) =>
                            updateBenefit(idx, { icon: v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ICON_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label>Título</Label>
                        <Input
                          value={benefit.title}
                          onChange={(e) =>
                            updateBenefit(idx, { title: e.target.value })
                          }
                          placeholder="ex: 10% de Cashback na próxima compra."
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>
                        Texto do link &quot;saiba mais&quot;{" "}
                        <span className="text-xs text-muted-foreground font-normal">
                          (opcional)
                        </span>
                      </Label>
                      <Input
                        value={benefit.link_label || ""}
                        onChange={(e) =>
                          updateBenefit(idx, { link_label: e.target.value })
                        }
                        placeholder="ex: Saiba mais sobre o cashback."
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>
                        Modal{" "}
                        <span className="text-xs text-muted-foreground font-normal">
                          (preencha para tornar o link clicável)
                        </span>
                      </Label>
                      <Input
                        value={benefit.modal_title || ""}
                        onChange={(e) =>
                          updateBenefit(idx, { modal_title: e.target.value })
                        }
                        placeholder="Título do modal"
                      />
                      <Textarea
                        value={benefit.modal_body || ""}
                        onChange={(e) =>
                          updateBenefit(idx, { modal_body: e.target.value })
                        }
                        placeholder="Conteúdo HTML"
                        rows={5}
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ======================== TAB: PREVIEW ======================== */}
        <TabsContent value="preview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Preview Interativo —{" "}
                {isMultistep ? "Multi-etapas" : "Brinde único"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>
                  Valor simulado do carrinho: R$ {formatBRL(previewCart)}
                </Label>
                <input
                  type="range"
                  min={0}
                  max={
                    isMultistep
                      ? maxStepThreshold * 1.2
                      : config.threshold * 1.5 || 500
                  }
                  step={1}
                  value={previewCart}
                  onChange={(e) => setPreviewCart(Number(e.target.value))}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>R$ 0,00</span>
                  {isMultistep ? (
                    <span>
                      R$ {formatBRL(maxStepThreshold)} (último marco)
                    </span>
                  ) : (
                    <span>R$ {formatBRL(config.threshold)} (meta)</span>
                  )}
                  <span>
                    R${" "}
                    {formatBRL(
                      isMultistep
                        ? maxStepThreshold * 1.2
                        : config.threshold * 1.5
                    )}
                  </span>
                </div>
              </div>

              {/* Live preview */}
              <div className="rounded-lg border overflow-hidden">
                <div
                  style={{
                    background:
                      isMultistep && !nextStep && previewCart > 0
                        ? config.achieved_bg_color
                        : !isMultistep && achieved
                          ? config.achieved_bg_color
                          : config.bg_color,
                    color:
                      isMultistep && !nextStep && previewCart > 0
                        ? config.achieved_text_color
                        : !isMultistep && achieved
                          ? config.achieved_text_color
                          : config.text_color,
                    padding: "10px 16px",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: config.font_size,
                  }}
                >
                  <div
                    style={{
                      maxWidth: 1200,
                      margin: "0 auto",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    {!isMultistep && config.gift_image_url && (
                      <img
                        src={config.gift_image_url}
                        alt={config.gift_name}
                        style={{
                          width: 32,
                          height: 32,
                          objectFit: "contain",
                          borderRadius: 4,
                        }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    )}
                    <div style={{ flex: 1 }}>
                      <p
                        style={{
                          margin: "0 0 8px",
                          fontWeight: 600,
                          textAlign: "center",
                        }}
                      >
                        {isMultistep
                          ? getMultistepMessage(previewCart)
                          : getPreviewMessage(previewCart)}
                      </p>
                      <div
                        style={{
                          width: "100%",
                          height: config.bar_height,
                          background: config.bar_bg_color,
                          borderRadius: 999,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            background: config.bar_color,
                            borderRadius: 999,
                            transition: "width 0.5s ease",
                          }}
                        />
                      </div>

                      {isMultistep && (
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginTop: 14,
                            padding: "0 4px",
                          }}
                        >
                          {sortedSteps.map((step, idx) => {
                            const active =
                              previewCart >= Number(step.threshold);
                            return (
                              <div
                                key={idx}
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  gap: 4,
                                  fontSize: 11,
                                  lineHeight: 1.2,
                                  textAlign: "center",
                                  flex: "0 0 auto",
                                }}
                              >
                                <div
                                  style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: "50%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    background: active
                                      ? config.bar_color
                                      : "#f3f4f6",
                                    color: active ? "#fff" : "#9ca3af",
                                    border: `2px solid ${
                                      active ? config.bar_color : "#e5e7eb"
                                    }`,
                                    transition: "all .25s ease",
                                  }}
                                >
                                  <StepIcon name={step.icon} />
                                </div>
                                <div
                                  style={{
                                    fontWeight: 500,
                                    maxWidth: 80,
                                  }}
                                >
                                  {step.label}
                                  {step.modal_body ? "*" : ""}
                                </div>
                                <div
                                  style={{
                                    color: "#9ca3af",
                                    fontSize: 10,
                                  }}
                                >
                                  R$ {formatBRL(Number(step.threshold))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Per-mode helper text */}
              {isMultistep ? (
                <p className="text-xs text-muted-foreground text-center">
                  Mova o slider para ver os marcos sendo desbloqueados. Etapas
                  com modal aparecem com asterisco no rótulo.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-4 text-center text-sm">
                  <div
                    className={`rounded-lg border p-3 ${
                      previewCart <= 0 ? "ring-2 ring-primary" : ""
                    }`}
                  >
                    <p className="font-medium">Carrinho vazio</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {interpolateMessage(config.message_empty, 0)}
                    </p>
                  </div>
                  <div
                    className={`rounded-lg border p-3 ${
                      previewCart > 0 && previewCart < config.threshold
                        ? "ring-2 ring-primary"
                        : ""
                    }`}
                  >
                    <p className="font-medium">Em progresso</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {interpolateMessage(
                        config.message_progress,
                        config.threshold / 2
                      )}
                    </p>
                  </div>
                  <div
                    className={`rounded-lg border p-3 ${
                      achieved ? "ring-2 ring-primary" : ""
                    }`}
                  >
                    <p className="font-medium">Conquistado</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {interpolateMessage(
                        config.message_achieved,
                        config.threshold
                      )}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ======================== TAB: INSTALL ======================== */}
        <TabsContent value="install" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Key className="h-4 w-4" />
                Status da Integração
              </CardTitle>
            </CardHeader>
            <CardContent>
              {hasApiKey ? (
                <div className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-green-600 mt-0.5" />
                  <div>
                    <p className="font-medium">Integração pronta</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      A régua de brinde usa a mesma API key e script das
                      Prateleiras Inteligentes. Nenhuma configuração adicional é
                      necessária — basta ativar a régua e ela aparecerá
                      automaticamente na loja.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <Key className="h-5 w-5 text-amber-500 mt-0.5" />
                  <div>
                    <p className="font-medium">API key necessária</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Você precisa criar uma API key e instalar o script das
                      Prateleiras na loja antes de usar a régua de brinde.
                    </p>
                    <Button variant="outline" size="sm" className="mt-3" asChild>
                      <Link href="/shelves">
                        <ExternalLink className="h-3 w-3 mr-2" />
                        Ir para Prateleiras
                      </Link>
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Como funciona</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                A régua de brinde é carregada automaticamente pelo mesmo script
                das Prateleiras Inteligentes (<code>shelves.js</code>).
              </p>
              <p>
                Quando ativa, ela aparece no topo (ou rodapé) de todas as páginas
                da loja, lendo o valor do carrinho do cliente em tempo real e
                mostrando quanto falta para atingir o valor mínimo configurado.
              </p>
              <p>
                A barra se atualiza automaticamente quando o cliente adiciona ou
                remove produtos do carrinho.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

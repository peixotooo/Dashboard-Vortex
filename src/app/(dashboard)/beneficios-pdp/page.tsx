"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Crown,
  Gift,
  Heart,
  Info,
  Loader2,
  Medal,
  Percent,
  Plus,
  Save,
  Shirt,
  ShoppingBag,
  Sparkles,
  Star,
  Trash2,
  Truck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  pdp_inline: boolean;
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
  pdp_inline: false,
};

const FREE_SHIPPING_TABLE_TEMPLATE = `<p>Frete gr&aacute;tis acima do valor m&iacute;nimo para cada regi&atilde;o:</p>
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

const ICON_OPTIONS = [
  { value: "truck", label: "Frete", Icon: Truck },
  { value: "gift", label: "Brinde", Icon: Gift },
  { value: "star", label: "Estrela", Icon: Star },
  { value: "heart", label: "Coração", Icon: Heart },
  { value: "percent", label: "Desconto", Icon: Percent },
  { value: "sparkles", label: "Brilho", Icon: Sparkles },
  { value: "bag", label: "Sacola", Icon: ShoppingBag },
  { value: "crown", label: "Coroa", Icon: Crown },
  { value: "medal", label: "Medalha", Icon: Medal },
  { value: "shirt", label: "Camiseta", Icon: Shirt },
  { value: "info", label: "Informação", Icon: Info },
];

function mergeWithDefaults(raw: Partial<GiftBarConfig> | null): GiftBarConfig {
  const data = raw || {};
  return {
    ...DEFAULT_CONFIG,
    ...data,
    steps: Array.isArray(data.steps) ? data.steps : [],
    show_on_pages: Array.isArray(data.show_on_pages)
      ? data.show_on_pages
      : ["all"],
    product_benefits: Array.isArray(data.product_benefits)
      ? data.product_benefits
      : [],
    product_benefits_title:
      data.product_benefits_title || DEFAULT_CONFIG.product_benefits_title,
    product_benefits_anchor: data.product_benefits_anchor ?? "",
    show_product_benefits: data.show_product_benefits === true,
    pdp_inline: data.pdp_inline === true,
    message_next_step:
      data.message_next_step || DEFAULT_CONFIG.message_next_step,
    message_all_achieved:
      data.message_all_achieved || DEFAULT_CONFIG.message_all_achieved,
  };
}

function iconFor(name: string) {
  return ICON_OPTIONS.find((opt) => opt.value === name)?.Icon || Info;
}

export default function PdpBenefitsPage() {
  const { workspace } = useWorkspace();
  const [config, setConfig] = useState<GiftBarConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "x-workspace-id": workspace?.id || "",
    }),
    [workspace?.id]
  );

  const loadConfig = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gift-bar/config", { headers: headers() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao carregar");
      setConfig(mergeWithDefaults(data.config));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [workspace?.id, headers]);

  useEffect(() => {
    if (workspace?.id) {
      loadConfig();
    }
  }, [workspace?.id, loadConfig]);

  const firstBenefit = useMemo(
    () =>
      config.product_benefits[0] || {
        icon: "info",
        title: "10% de Cashback na próxima compra.",
        link_label: "Saiba mais sobre o cashback.",
      },
    [config.product_benefits]
  );

  async function handleSave() {
    if (!workspace?.id) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/gift-bar/config", {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao salvar");
      setConfig(mergeWithDefaults(data.config));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  function updateConfig(partial: Partial<GiftBarConfig>) {
    setConfig((prev) => ({ ...prev, ...partial }));
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
          icon: "percent",
          title: "10% de Cashback na próxima compra.",
          link_label: "Saiba mais sobre o cashback.",
          modal_title: "Cashback Bulking",
          modal_body:
            "<p>A cada compra você recebe <strong>10% de cashback</strong> que vira crédito para usar na próxima.</p><p>O crédito é liberado após o prazo de troca e não acumula com outros descontos.</p>",
        },
        {
          icon: "truck",
          title: "Frete grátis a partir de R$ 299*",
          link_label: "Confira por região.",
          modal_title: "Frete grátis por região",
          modal_body: FREE_SHIPPING_TABLE_TEMPLATE,
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

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const PreviewIcon = iconFor(firstBenefit.icon);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Benefícios PDP</h1>
          <p className="text-sm text-muted-foreground">
            Cards “Nossos benefícios” exibidos abaixo do botão comprar nas
            páginas de produto.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={config.show_product_benefits}
            onCheckedChange={(v) => updateConfig({ show_product_benefits: v })}
          />
          <Badge variant={config.show_product_benefits ? "default" : "secondary"}>
            {config.show_product_benefits ? "Ativo" : "Inativo"}
          </Badge>
          <Button onClick={handleSave} disabled={saving || !workspace?.id}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : saved ? (
              <Check className="mr-2 h-4 w-4" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {saved ? "Salvo" : "Salvar"}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-3 text-sm text-red-800">{error}</CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Configuração</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
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
                <Label>Seletor CSS de ancoragem</Label>
                <Input
                  value={config.product_benefits_anchor}
                  onChange={(e) =>
                    updateConfig({ product_benefits_anchor: e.target.value })
                  }
                  placeholder=".product-buy"
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={applyBulkingBenefitsPreset}>
              Preset Bulking
            </Button>
            <Button variant="outline" size="sm" onClick={addBenefit}>
              <Plus className="mr-1 h-4 w-4" />
              Novo benefício
            </Button>
          </div>

          {config.product_benefits.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Nenhum benefício configurado. Use o preset Bulking ou adicione
                um novo.
              </CardContent>
            </Card>
          ) : (
            config.product_benefits.map((benefit, idx) => (
              <Card key={idx}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-sm">
                      Benefício #{idx + 1}
                    </CardTitle>
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
                        disabled={idx === config.product_benefits.length - 1}
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
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Ícone</Label>
                      <Select
                        value={benefit.icon}
                        onValueChange={(v) => updateBenefit(idx, { icon: v })}
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
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Texto do link “saiba mais”</Label>
                    <Input
                      value={benefit.link_label || ""}
                      onChange={(e) =>
                        updateBenefit(idx, { link_label: e.target.value })
                      }
                      placeholder="ex: Saiba mais sobre o cashback."
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Título do modal</Label>
                    <Input
                      value={benefit.modal_title || ""}
                      onChange={(e) =>
                        updateBenefit(idx, { modal_title: e.target.value })
                      }
                      placeholder="Título do modal"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Conteúdo do modal</Label>
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
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-500">
                  {config.product_benefits_title || "Nossos benefícios"}
                </p>
                <div className="flex gap-1">
                  {config.product_benefits.slice(0, 5).map((_, idx) => (
                    <span
                      key={idx}
                      className={`h-2 rounded-full ${
                        idx === 0 ? "w-6 bg-slate-900" : "w-2 bg-slate-200"
                      }`}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border bg-white">
                  <PreviewIcon className="h-6 w-6 text-slate-900" />
                </div>
                <div className="min-w-0">
                  <p className="text-base font-bold leading-snug text-slate-900">
                    {firstBenefit.title}
                  </p>
                  {firstBenefit.link_label && (
                    <p className="mt-1 text-sm text-slate-500">
                      {firstBenefit.link_label} &gt;
                    </p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

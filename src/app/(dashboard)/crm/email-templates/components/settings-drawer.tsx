"use client";
import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Settings } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EmailTemplateSettings } from "@/lib/email-templates/types";
import { LocawebSettingsContent } from "./locaweb-settings-content";
import { IportoSettingsContent } from "./iporto-settings-content";

type EmailProvider = "locaweb" | "iporto";

export function SettingsDrawer({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<EmailTemplateSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState<EmailProvider>("locaweb");
  const [savingProvider, setSavingProvider] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/crm/email-templates/settings", {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then(setSettings);
    fetch("/api/crm/email-templates/provider", {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d: { provider?: EmailProvider }) => {
        if (d?.provider === "iporto" || d?.provider === "locaweb") {
          setProvider(d.provider);
        }
      });
  }, [open, workspaceId]);

  async function changeProvider(next: EmailProvider) {
    setSavingProvider(true);
    try {
      const r = await fetch("/api/crm/email-templates/provider", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({ provider: next }),
      });
      if (r.ok) setProvider(next);
    } finally {
      setSavingProvider(false);
    }
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const r = await fetch("/api/crm/email-templates/settings", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-workspace-id": workspaceId },
        body: JSON.stringify(settings),
      });
      const data = await r.json();
      setSettings(data);
    } finally {
      setSaving(false);
    }
  }

  function patch<K extends keyof EmailTemplateSettings>(
    k: K,
    v: EmailTemplateSettings[K]
  ) {
    setSettings((s) => (s ? { ...s, [k]: v } : s));
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings className="w-4 h-4 mr-1" /> Configurações
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Configurações · Email Templates</SheetTitle>
        </SheetHeader>
        <div className="p-4">
          <Tabs defaultValue="generation">
            <TabsList className="w-full">
              <TabsTrigger value="generation" className="flex-1">
                Geração diária
              </TabsTrigger>
              <TabsTrigger value="locaweb" className="flex-1">
                Email Marketing
              </TabsTrigger>
            </TabsList>

            <TabsContent value="generation" className="space-y-4 pt-4">
              {!settings && <div>Carregando...</div>}
              {settings && (
                <>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="enabled">Geração diária ativa</Label>
                    <Switch
                      id="enabled"
                      checked={settings.enabled}
                      onCheckedChange={(v) => patch("enabled", v)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Lookback best-seller (d)">
                      <Input
                        type="number"
                        value={settings.bestseller_lookback_days}
                        onChange={(e) =>
                          patch("bestseller_lookback_days", Number(e.target.value))
                        }
                      />
                    </Field>
                    <Field label="Estoque mín. best-seller">
                      <Input
                        type="number"
                        value={settings.min_stock_bestseller}
                        onChange={(e) => patch("min_stock_bestseller", Number(e.target.value))}
                      />
                    </Field>
                    <Field label="Lookback sem-giro (d)">
                      <Input
                        type="number"
                        value={settings.slowmoving_lookback_days}
                        onChange={(e) =>
                          patch("slowmoving_lookback_days", Number(e.target.value))
                        }
                      />
                    </Field>
                    <Field label="Vendas máx. sem-giro">
                      <Input
                        type="number"
                        value={settings.slowmoving_max_sales}
                        onChange={(e) => patch("slowmoving_max_sales", Number(e.target.value))}
                      />
                    </Field>
                    <Field label="Desconto sem-giro %">
                      <Input
                        type="number"
                        min={5}
                        max={20}
                        value={settings.slowmoving_discount_percent}
                        onChange={(e) =>
                          patch("slowmoving_discount_percent", Number(e.target.value))
                        }
                      />
                    </Field>
                    <Field label="Validade cupom (h)">
                      <Input
                        type="number"
                        min={12}
                        max={168}
                        value={settings.slowmoving_coupon_validity_hours}
                        onChange={(e) =>
                          patch("slowmoving_coupon_validity_hours", Number(e.target.value))
                        }
                      />
                    </Field>
                    <Field label="Lookback novidade (d)">
                      <Input
                        type="number"
                        value={settings.newarrival_lookback_days}
                        onChange={(e) =>
                          patch("newarrival_lookback_days", Number(e.target.value))
                        }
                      />
                    </Field>
                  </div>
                  <div className="space-y-2">
                    <Label>Provider de copy</Label>
                    <Select
                      value={settings.copy_provider}
                      onValueChange={(v) => patch("copy_provider", v as EmailTemplateSettings["copy_provider"])}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="template">Template (default)</SelectItem>
                        <SelectItem value="llm">LLM via team-agent</SelectItem>
                      </SelectContent>
                    </Select>
                    {settings.copy_provider === "llm" && (
                      <div>
                        <Label>Slug do agent</Label>
                        <Input
                          placeholder="copywriting | email-sequence"
                          value={settings.llm_agent_slug ?? ""}
                          onChange={(e) => patch("llm_agent_slug", e.target.value || null)}
                        />
                      </div>
                    )}
                  </div>
                  <Button onClick={save} disabled={saving} className="w-full">
                    {saving ? "Salvando..." : "Salvar"}
                  </Button>
                </>
              )}
            </TabsContent>

            <TabsContent value="locaweb" className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Provider ativo</Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={provider === "locaweb" ? "default" : "outline"}
                    onClick={() => changeProvider("locaweb")}
                    disabled={savingProvider}
                    className="flex-1"
                  >
                    Locaweb
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={provider === "iporto" ? "default" : "outline"}
                    onClick={() => changeProvider("iporto")}
                    disabled={savingProvider}
                    className="flex-1"
                  >
                    iPORTO
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  O dispatch de e-mail vai usar este provider. Locaweb faz fan-out
                  via list_ids; iPORTO envia 1 request por destinatário (cap 500
                  por disparo síncrono).
                </p>
              </div>

              <div className="border-t pt-4">
                {provider === "iporto" ? (
                  <IportoSettingsContent workspaceId={workspaceId} />
                ) : (
                  <LocawebSettingsContent workspaceId={workspaceId} />
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

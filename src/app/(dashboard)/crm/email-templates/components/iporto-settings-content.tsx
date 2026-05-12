"use client";

// IportoSettingsContent — form das credenciais iPORTO.
// Pareado ao LocawebSettingsContent. Mostra token (oculto), webhook
// secret, base_url. Sender (from email/name) é compartilhado entre
// providers — fica em default_sender_email/default_sender_name na
// mesma tabela workspace_email_marketing, então usa o mesmo form de
// Locaweb pra editar.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
} from "lucide-react";

interface IportoSettings {
  enabled: boolean;
  base_url: string;
  token: string | null;
  token_set: boolean;
  webhook_secret: string | null;
  webhook_secret_set: boolean;
  default_sender_email: string | null;
  default_sender_name: string | null;
}

export function IportoSettingsContent({ workspaceId }: { workspaceId: string }) {
  const [, setSettings] = useState<IportoSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [senderEmail, setSenderEmail] = useState("");
  const [senderName, setSenderName] = useState("");
  const [tokenAlreadySet, setTokenAlreadySet] = useState(false);
  const [secretAlreadySet, setSecretAlreadySet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [probeResult, setProbeResult] = useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    fetch("/api/crm/email-templates/iporto/settings", {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d: IportoSettings) => {
        setSettings(d);
        setBaseUrl(d.base_url);
        setSenderEmail(d.default_sender_email ?? "");
        setSenderName(d.default_sender_name ?? "");
        setTokenAlreadySet(!!d.token_set);
        setSecretAlreadySet(!!d.webhook_secret_set);
      })
      .catch((err) => setError((err as Error).message));
  }, [workspaceId]);

  async function test() {
    setTesting(true);
    setError(null);
    setProbeResult(null);
    try {
      const r = await fetch("/api/crm/email-templates/iporto/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          test: true,
          base_url: baseUrl,
          token: token || undefined,
        }),
      });
      const d = await r.json();
      setProbeResult(d.ok ? { ok: true } : { ok: false, error: d.error });
    } catch (err) {
      setProbeResult({ ok: false, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, string> = { base_url: baseUrl };
      if (token) body.token = token;
      if (webhookSecret) body.webhook_secret = webhookSecret;
      if (senderEmail) body.default_sender_email = senderEmail;
      if (senderName) body.default_sender_name = senderName;
      const r = await fetch("/api/crm/email-templates/iporto/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      const d = (await r.json()) as IportoSettings;
      setSettings(d);
      setTokenAlreadySet(!!d.token_set);
      setSecretAlreadySet(!!d.webhook_secret_set);
      setToken("");
      setWebhookSecret("");
      setSavedAt(new Date());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-muted bg-muted/30 p-3 text-xs text-muted-foreground">
        Token JWT é gerado no painel{" "}
        <a
          href="https://app.iporto.com.br/api"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          app.iporto.com.br
        </a>{" "}
        em &quot;Página inicial → API → Nova API&quot;. Validade 1 ano.
      </div>

      <div className="space-y-2">
        <Label>Base URL</Label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.iporto.com.br/api/panel/application"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Remetente (from email)</Label>
          <Input
            value={senderEmail}
            onChange={(e) => setSenderEmail(e.target.value)}
            placeholder="no-reply@bulking.com.br"
            type="email"
          />
          <p className="text-[10px] text-muted-foreground">
            Tem que ser um endereço de domínio autorizado no painel iPORTO. Se vazio, usa o sender da Locaweb (não recomendado).
          </p>
        </div>
        <div className="space-y-2">
          <Label>Nome do remetente</Label>
          <Input
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            placeholder="Bulking"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Token JWT</Label>
        <div className="flex gap-2">
          <Input
            type={showToken ? "text" : "password"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              tokenAlreadySet ? "•••••• (já salvo — em branco mantém)" : "eyJhbGciOi..."
            }
            className="font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setShowToken((v) => !v)}
          >
            {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Webhook secret (opcional)</Label>
        <div className="flex gap-2">
          <Input
            type={showSecret ? "text" : "password"}
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder={
              secretAlreadySet
                ? "•••••• (já salvo — em branco mantém)"
                : "string aleatória"
            }
            className="font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setShowSecret((v) => !v)}
          >
            {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Configure o mesmo valor no painel do iPORTO em &quot;Webhooks&quot;.
          Webhook URL:{" "}
          <code className="rounded bg-muted px-1">/api/webhooks/iporto</code>
        </p>
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={test}
          disabled={testing || (!token && !tokenAlreadySet)}
        >
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Testar conexão
        </Button>
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Salvar
        </Button>
      </div>

      {probeResult && (
        <div
          className={`flex items-center gap-2 text-sm ${probeResult.ok ? "text-green-700" : "text-red-700"}`}
        >
          {probeResult.ok ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <AlertTriangle className="w-4 h-4" />
          )}
          {probeResult.ok ? "Conexão OK" : probeResult.error}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}

      {savedAt && !error && (
        <p className="text-xs text-muted-foreground">
          Salvo em {savedAt.toLocaleTimeString("pt-BR")}
        </p>
      )}
    </div>
  );
}

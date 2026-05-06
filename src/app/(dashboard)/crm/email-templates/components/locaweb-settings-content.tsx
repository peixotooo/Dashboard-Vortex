"use client";

// LocawebSettingsContent — embeddable form for the Locaweb integration.
// Used inside the unified Configurações drawer; no Sheet wrapper of its own
// so it can be slotted under a tab. The outer LocawebSettingsDrawer used
// to render this in a separate header button — that button was removed,
// and this content is now reachable only via Configurações (admin-only).

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
} from "lucide-react";

interface Settings {
  enabled: boolean;
  base_url: string;
  account_id: string | null;
  token: string | null;
  token_set: boolean;
  default_sender_email: string | null;
  default_sender_name: string | null;
  default_domain_id: string | null;
  list_ids: Record<string, string>;
}

interface Sender {
  email: string;
  status?: string;
}
interface Domain {
  id: string;
  name: string;
  status?: string;
}

export function LocawebSettingsContent({ workspaceId }: { workspaceId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [senderEmail, setSenderEmail] = useState("");
  const [senderName, setSenderName] = useState("");
  const [domainId, setDomainId] = useState("");
  const [senders, setSenders] = useState<Sender[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [discoverError, setDiscoverError] = useState<{
    senders?: string | null;
    domains?: string | null;
  }>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [probeResult, setProbeResult] = useState<
    { ok: true; lists: number } | { ok: false; error: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    fetch("/api/crm/email-templates/locaweb/settings", {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d: Settings) => {
        setSettings(d);
        setEnabled(d.enabled);
        setAccountId(d.account_id ?? "");
        setSenderEmail(d.default_sender_email ?? "");
        setSenderName(d.default_sender_name ?? "");
        setDomainId(d.default_domain_id ?? "");
      });
    fetch("/api/crm/email-templates/locaweb/discover", {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d) => {
        setSenders(Array.isArray(d.senders) ? d.senders : []);
        setDomains(Array.isArray(d.domains) ? d.domains : []);
        setDiscoverError({
          senders: d.senders_error ?? null,
          domains: d.domains_error ?? null,
        });
      })
      .catch((err) => {
        setDiscoverError({
          senders: (err as Error).message,
          domains: (err as Error).message,
        });
      });
  }, [workspaceId]);

  const test = async () => {
    setTesting(true);
    setProbeResult(null);
    try {
      const r = await fetch("/api/crm/email-templates/locaweb/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          test: true,
          account_id: accountId || undefined,
          token: token || undefined,
        }),
      });
      const d = await r.json();
      if (d.ok) setProbeResult({ ok: true, lists: d.probe?.lists ?? 0 });
      else setProbeResult({ ok: false, error: d.error ?? "ping falhou" });
    } catch (err) {
      setProbeResult({ ok: false, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (domainId && /^https?:\/\//i.test(domainId)) {
      setError(
        "Domínio inválido — esse campo é o domain_id (alfanumérico), não a URL da API."
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        enabled,
        account_id: accountId || null,
        default_sender_email: senderEmail || null,
        default_sender_name: senderName || null,
        default_domain_id: domainId || null,
      };
      if (token) body.token = token;

      const r = await fetch("/api/crm/email-templates/locaweb/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Falha ao salvar.");
      setSettings(d);
      setSavedAt(new Date());
      setToken("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (settings === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border rounded-lg p-3">
        <div className="space-y-0.5">
          <div className="text-sm font-medium">Integração ativa</div>
          <div className="text-[11px] text-muted-foreground">
            Quando ligado, o botão "Disparar" no editor envia via Locaweb.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((v) => !v)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors ${
            enabled
              ? "bg-foreground border-foreground"
              : "bg-card border-border"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 mt-[2px] transform rounded-full bg-background transition ${
              enabled ? "translate-x-5" : "translate-x-[2px]"
            }`}
          />
        </button>
      </div>

      <div className="space-y-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Credenciais
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Account ID</Label>
          <Input
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="ex: 202654"
            className="h-9 text-sm font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs flex items-center justify-between">
            <span>
              Token (X-Auth-Token)
              {settings.token_set && (
                <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                  {settings.token}
                </span>
              )}
            </span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setShowToken((v) => !v)}
            >
              {showToken ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
          </Label>
          <Input
            type={showToken ? "text" : "password"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              settings.token_set
                ? "(deixe vazio pra manter o atual)"
                : "Cole o token da Locaweb"
            }
            className="h-9 text-sm font-mono"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={test}
            disabled={testing || (!accountId && !settings.account_id)}
            className="gap-1.5"
          >
            {testing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3 h-3" />
            )}
            Testar conexão
          </Button>
          {probeResult?.ok && (
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
              ✓ Conectou · {probeResult.lists} lista(s)
            </span>
          )}
          {probeResult && !probeResult.ok && (
            <span className="text-[11px] text-destructive flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {probeResult.error.slice(0, 60)}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3 border-t pt-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Remetente padrão
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Email do remetente</Label>
          {senders.length > 0 ? (
            <Select value={senderEmail} onValueChange={setSenderEmail}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Escolha um sender" />
              </SelectTrigger>
              <SelectContent>
                {senders.map((s) => (
                  <SelectItem key={s.email} value={s.email}>
                    {s.email}
                    {s.status && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        · {s.status}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <>
              <Input
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                placeholder="contato@bulking.com.br"
                className="h-9 text-sm"
              />
              {discoverError.senders && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed">
                  Não foi possível listar senders automaticamente:{" "}
                  {discoverError.senders.slice(0, 100)}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Use um email do domínio que você verificou na Locaweb.
              </p>
            </>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Nome de exibição</Label>
          <Input
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            placeholder="Bulking"
            className="h-9 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Domínio (domain_id)</Label>
          {domains.length > 0 ? (
            <Select value={domainId} onValueChange={setDomainId}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Escolha um domínio" />
              </SelectTrigger>
              <SelectContent>
                {domains.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                    {d.status && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        · {d.status}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <>
              <Input
                value={domainId}
                onChange={(e) => setDomainId(e.target.value)}
                placeholder="ex: 5f8e28abf8d79f935000002"
                className="h-9 text-sm font-mono"
              />
              {discoverError.domains && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed">
                  Não foi possível listar domínios automaticamente:{" "}
                  {discoverError.domains.slice(0, 100)}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Cole aqui o <span className="font-mono">domain_id</span> do
                domínio verificado.{" "}
                <a
                  href={`https://emailmarketing.locaweb.com.br/api/v1/accounts/${settings.account_id ?? ""
                    }/domains`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-foreground"
                >
                  Ver na API
                </a>{" "}
                ou no painel Locaweb → Configurações → Domínios. Não é a URL — é
                um id alfanumérico.
              </p>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="text-xs text-destructive p-2 border border-destructive/30 rounded bg-destructive/5">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-2">
        {savedAt && (
          <span className="text-[11px] text-muted-foreground">
            salvo {savedAt.toLocaleTimeString()}
          </span>
        )}
        <Button
          size="sm"
          onClick={save}
          disabled={saving}
          className="gap-1.5 ml-auto"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          Salvar
        </Button>
      </div>

      <div className="text-[10px] text-muted-foreground leading-relaxed border-t pt-3">
        Sem webhooks na Locaweb. Stats (open/click/bounce) são puxadas a cada
        6h por um cron e aparecem no histórico de cada draft disparado.
      </div>
    </div>
  );
}

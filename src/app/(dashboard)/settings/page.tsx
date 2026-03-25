"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  Shield,
  CheckCircle,
  XCircle,
  RefreshCw,
  Key,
  Activity,
  Users,
  Trash2,
  UserPlus,
  Building2,
  Star,
  Save,
  ShoppingBag,
  Cpu,
  Mail,
  Copy,
  Link,
  RotateCcw,
  Globe,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useWorkspace } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth-context";
import { FEATURES, ALL_FEATURE_IDS } from "@/lib/features";

interface MetaAccount {
  id: string;
  name: string;
  account_id?: string;
  selected?: boolean;
  is_default?: boolean;
}

interface SavedAccount {
  account_id: string;
  account_name: string;
  is_default: boolean;
}

export default function SettingsPage() {
  const { workspace, members, userRole, refreshMembers, refreshWorkspaces } = useWorkspace();
  const { user } = useAuth();
  const isAdmin = userRole === "owner" || userRole === "admin";

  // Meta Connection
  const [metaToken, setMetaToken] = useState("");
  const [metaAppId, setMetaAppId] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [tokenSaved, setTokenSaved] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [hasConnection, setHasConnection] = useState(false);
  const [connectionInfo, setConnectionInfo] = useState<{ app_id?: string; created_at?: string } | null>(null);

  // Account selection
  const [allAccounts, setAllAccounts] = useState<MetaAccount[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [defaultAccountId, setDefaultAccountId] = useState<string>("");
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [savingAccounts, setSavingAccounts] = useState(false);
  const [accountsMessage, setAccountsMessage] = useState("");
  const [accountsError, setAccountsError] = useState("");

  // Health Check
  const [healthResult, setHealthResult] = useState<Record<string, unknown> | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // Team
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [teamMessage, setTeamMessage] = useState("");
  const [teamError, setTeamError] = useState("");

  // Invite feature permissions
  const [inviteFeatures, setInviteFeatures] = useState<string[]>(ALL_FEATURE_IDS);

  // Pending invitations
  interface PendingInvite {
    id: string;
    email: string;
    role: string;
    status: string;
    created_at: string;
    expires_at: string;
  }
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);

  // Workspace edit
  const [wsName, setWsName] = useState("");
  const [wsSlug, setWsSlug] = useState("");
  const [savingWs, setSavingWs] = useState(false);
  const [wsMessage, setWsMessage] = useState("");
  const [wsError, setWsError] = useState("");

  // VNDA Connection
  const [vndaToken, setVndaToken] = useState("");
  const [vndaHost, setVndaHost] = useState("");
  const [vndaName, setVndaName] = useState("");
  const [savingVnda, setSavingVnda] = useState(false);
  const [vndaSaved, setVndaSaved] = useState(false);
  const [vndaError, setVndaError] = useState("");
  const [hasVndaConnection, setHasVndaConnection] = useState(false);
  const [vndaConnectionInfo, setVndaConnectionInfo] = useState<{ store_host?: string; store_name?: string; created_at?: string; webhook_token?: string } | null>(null);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [regeneratingToken, setRegeneratingToken] = useState(false);
  const [testingVnda, setTestingVnda] = useState(false);
  const [vndaTestResult, setVndaTestResult] = useState<{ ok?: boolean; message?: string } | null>(null);

  // Custom Domain
  const [customDomain, setCustomDomain] = useState("");
  const [customDomainInput, setCustomDomainInput] = useState("");
  const [domainVerified, setDomainVerified] = useState(false);
  const [domainVerification, setDomainVerification] = useState<Array<{ type: string; domain: string; value: string }>>([]);
  const [savingDomain, setSavingDomain] = useState(false);
  const [verifyingDomain, setVerifyingDomain] = useState(false);
  const [removingDomain, setRemovingDomain] = useState(false);
  const [domainMessage, setDomainMessage] = useState("");
  const [domainError, setDomainError] = useState("");

  // LLM Provider
  const [llmProvider, setLlmProvider] = useState<"anthropic" | "openrouter">("anthropic");
  const [allowedModels, setAllowedModels] = useState("");
  const [savingProvider, setSavingProvider] = useState(false);
  const [providerSaved, setProviderSaved] = useState(false);
  const [providerError, setProviderError] = useState("");

  // Eccosys Connection (env-var based — read-only status)
  const [eccosysConfigured, setEccosysConfigured] = useState(false);
  const [eccosysAmbiente, setEccosysAmbiente] = useState<string | null>(null);
  const [testingEccosys, setTestingEccosys] = useState(false);
  const [eccosysTestResult, setEccosysTestResult] = useState<{
    ok?: boolean;
    message?: string;
  } | null>(null);

  // Tab from URL (e.g. /settings?tab=eccosys)
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get("tab");

  // Load workspace data
  const loadWorkspaceData = useCallback(async () => {
    if (!workspace?.id) return;
    try {
      const res = await fetch(`/api/workspaces?workspace_id=${workspace.id}`);
      const data = await res.json();
      if (data.connection) {
        setHasConnection(true);
        setConnectionInfo(data.connection);
      }
      if (data.accounts) {
        setSavedAccounts(data.accounts);
        const selected = new Set<string>(data.accounts.map((a: SavedAccount) => a.account_id));
        setSelectedIds(selected);
        const def = data.accounts.find((a: SavedAccount) => a.is_default);
        if (def) setDefaultAccountId(def.account_id);
      }
      if (data.vndaConnection) {
        setHasVndaConnection(true);
        setVndaConnectionInfo(data.vndaConnection);
      }
      if (data.customDomain) {
        setCustomDomain(data.customDomain);
        setCustomDomainInput(data.customDomain);
      }
    } catch {
      // Silent
    }

    // Load Eccosys connection status (env-var based)
    try {
      const eccRes = await fetch("/api/eccosys/connections");
      const eccData = await eccRes.json();
      setEccosysConfigured(!!eccData.configured);
      setEccosysAmbiente(eccData.ambiente ?? null);
    } catch {
      // Silent
    }
  }, [workspace?.id]);

  useEffect(() => {
    loadWorkspaceData();
  }, [loadWorkspaceData]);

  // Load LLM provider config
  useEffect(() => {
    if (!workspace?.id) return;
    async function loadProvider() {
      try {
        const res = await fetch(`/api/agent/config?doc_type=provider_config`, {
          headers: { "x-workspace-id": workspace!.id },
        });
        const data = await res.json();
        if (data.document?.content) {
          const config = JSON.parse(data.document.content);
          if (config.provider) setLlmProvider(config.provider);
          if (config.allowedModels) setAllowedModels(config.allowedModels.join("\n"));
        }
      } catch {
        // Keep defaults
      }
    }
    loadProvider();
  }, [workspace?.id]);

  useEffect(() => {
    if (workspace) {
      setWsName(workspace.name);
      setWsSlug(workspace.slug);
    }
  }, [workspace]);

  // === Meta Connection handlers ===

  async function handleSaveMetaConnection() {
    if (!metaToken || !workspace) return;
    setSavingToken(true);
    setTokenError("");
    setTokenSaved(false);

    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_meta_connection",
          workspace_id: workspace.id,
          access_token: metaToken,
          app_id: metaAppId,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setTokenError(data.error);
      } else {
        setTokenSaved(true);
        setMetaToken("");
        setHasConnection(true);
        // Auto-fetch accounts after saving token
        await handleFetchAllAccounts();
      }
    } catch {
      setTokenError("Erro ao salvar conexão");
    } finally {
      setSavingToken(false);
    }
  }

  async function handleFetchAllAccounts() {
    if (!workspace) return;
    setLoadingAccounts(true);
    setAccountsError("");
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fetch_all_meta_accounts",
          workspace_id: workspace.id,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setAccountsError(data.error);
      } else if (data.accounts) {
        setAllAccounts(data.accounts);
        // Pre-select already saved accounts
        const selected = new Set<string>();
        let defId = "";
        data.accounts.forEach((a: MetaAccount) => {
          if (a.selected) selected.add(a.id);
          if (a.is_default) defId = a.id;
        });
        setSelectedIds(selected);
        if (defId) setDefaultAccountId(defId);
      }
    } catch {
      setAccountsError("Erro ao buscar contas da Meta");
    } finally {
      setLoadingAccounts(false);
    }
  }

  function toggleAccountSelection(accountId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
        // If removing the default, clear default
        if (defaultAccountId === accountId) setDefaultAccountId("");
      } else {
        next.add(accountId);
      }
      return next;
    });
  }

  async function handleSaveSelectedAccounts() {
    if (!workspace) return;
    setSavingAccounts(true);
    setAccountsMessage("");
    setAccountsError("");

    const selected = allAccounts
      .filter((a) => selectedIds.has(a.id))
      .map((a) => ({
        id: a.id,
        name: a.name,
        is_default: a.id === defaultAccountId,
      }));

    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_selected_accounts",
          workspace_id: workspace.id,
          accounts: selected,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setAccountsError(data.error);
      } else {
        setAccountsMessage("Contas salvas com sucesso!");
        await loadWorkspaceData();
      }
    } catch {
      setAccountsError("Erro ao salvar contas");
    } finally {
      setSavingAccounts(false);
    }
  }

  async function handleSetDefault(accountId: string) {
    if (!workspace) return;
    setDefaultAccountId(accountId);
    try {
      await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_default_account",
          workspace_id: workspace.id,
          account_id: accountId,
        }),
      });
    } catch {
      // Silent
    }
  }

  // === Health Check ===

  async function handleHealthCheck() {
    setHealthLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(workspace?.id ? { "x-workspace-id": workspace.id } : {}),
        },
        body: JSON.stringify({ action: "health" }),
      });
      const data = await res.json();
      setHealthResult(data);
    } catch (err) {
      setHealthResult({ error: String(err) });
    } finally {
      setHealthLoading(false);
    }
  }

  // === Team handlers ===

  const fetchPendingInvites = useCallback(async () => {
    if (!workspace?.id || !isAdmin) return;
    setLoadingInvites(true);
    try {
      const supabase = (await import("@/lib/supabase")).createClient();
      const { data } = await supabase
        .from("workspace_invitations")
        .select("id, email, role, status, created_at, expires_at")
        .eq("workspace_id", workspace.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      setPendingInvites((data || []) as PendingInvite[]);
    } catch {
      // Silent
    } finally {
      setLoadingInvites(false);
    }
  }, [workspace?.id, isAdmin]);

  useEffect(() => {
    fetchPendingInvites();
  }, [fetchPendingInvites]);

  async function handleInviteMember() {
    if (!inviteEmail || !workspace) return;
    setInviting(true);
    setTeamMessage("");
    setTeamError("");
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "invite_member",
          workspace_id: workspace.id,
          email: inviteEmail,
          role: inviteRole,
          features:
            inviteRole === "member" && inviteFeatures.length < ALL_FEATURE_IDS.length
              ? inviteFeatures
              : null,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setTeamError(data.error);
      } else {
        setTeamMessage("Convite enviado por email!");
        setInviteEmail("");
        setInviteFeatures(ALL_FEATURE_IDS);
        refreshMembers();
        fetchPendingInvites();
      }
    } catch {
      setTeamError("Erro ao convidar membro");
    } finally {
      setInviting(false);
    }
  }

  async function handleCancelInvite(invitationId: string) {
    if (!workspace) return;
    setTeamMessage("");
    setTeamError("");
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel_invite",
          workspace_id: workspace.id,
          invitation_id: invitationId,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setTeamError(data.error);
      } else {
        setTeamMessage("Convite cancelado");
        fetchPendingInvites();
      }
    } catch {
      setTeamError("Erro ao cancelar convite");
    }
  }

  async function handleResendInvite(invitationId: string) {
    if (!workspace) return;
    setTeamMessage("");
    setTeamError("");
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resend_invite",
          workspace_id: workspace.id,
          invitation_id: invitationId,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setTeamError(data.error);
      } else {
        setTeamMessage("Convite reenviado!");
        fetchPendingInvites();
      }
    } catch {
      setTeamError("Erro ao reenviar convite");
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!workspace) return;
    setTeamMessage("");
    setTeamError("");
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove_member",
          workspace_id: workspace.id,
          user_id: userId,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setTeamError(data.error);
      } else {
        setTeamMessage("Membro removido");
        refreshMembers();
      }
    } catch {
      setTeamError("Erro ao remover membro");
    }
  }

  async function handleUpdateRole(userId: string, newRole: string) {
    if (!workspace) return;
    setTeamMessage("");
    setTeamError("");
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_role",
          workspace_id: workspace.id,
          user_id: userId,
          role: newRole,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setTeamError(data.error);
      } else {
        setTeamMessage("Papel atualizado");
        refreshMembers();
      }
    } catch {
      setTeamError("Erro ao atualizar papel");
    }
  }

  async function handleToggleFeature(userId: string, featureId: string, enabled: boolean) {
    const member = members.find((m) => m.user_id === userId);
    if (!member || !workspace) return;

    const currentFeatures = member.features ?? [...ALL_FEATURE_IDS];
    const newFeatures = enabled
      ? [...new Set([...currentFeatures, featureId])]
      : currentFeatures.filter((f) => f !== featureId);

    // If all features enabled, send null (= full access)
    const featuresToSave =
      newFeatures.length >= ALL_FEATURE_IDS.length ? null : newFeatures;

    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_member_features",
          workspace_id: workspace.id,
          user_id: userId,
          features: featuresToSave,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setTeamError(data.error);
      } else {
        refreshMembers();
      }
    } catch {
      setTeamError("Erro ao atualizar permissoes");
    }
  }

  // === Workspace handlers ===

  async function handleSaveWorkspace() {
    if (!workspace) return;
    setSavingWs(true);
    setWsMessage("");
    setWsError("");
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_workspace",
          workspace_id: workspace.id,
          name: wsName,
          slug: wsSlug,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setWsError(data.error);
      } else {
        setWsMessage("Workspace atualizado!");
        refreshWorkspaces();
      }
    } catch {
      setWsError("Erro ao salvar workspace");
    } finally {
      setSavingWs(false);
    }
  }

  // === Custom Domain handlers ===

  async function handleSetDomain() {
    if (!customDomainInput || !workspace) return;
    setSavingDomain(true);
    setDomainMessage("");
    setDomainError("");
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_custom_domain",
          workspace_id: workspace.id,
          domain: customDomainInput.toLowerCase().trim(),
        }),
      });
      const data = await res.json();
      if (data.error) {
        setDomainError(data.error);
      } else {
        setCustomDomain(data.domain);
        setDomainVerified(data.verified);
        setDomainVerification(data.verification || []);
        setDomainMessage(data.verified ? "Domínio configurado e verificado!" : "Domínio adicionado. Configure o DNS abaixo.");
      }
    } catch {
      setDomainError("Erro ao configurar domínio");
    } finally {
      setSavingDomain(false);
    }
  }

  async function handleVerifyDomain() {
    if (!workspace) return;
    setVerifyingDomain(true);
    setDomainMessage("");
    setDomainError("");
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify_domain",
          workspace_id: workspace.id,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setDomainError(data.error);
      } else {
        setDomainVerified(data.verified);
        setDomainVerification(data.verification || []);
        if (data.verified) {
          setDomainMessage("DNS verificado! Seu domínio está ativo.");
        } else {
          setDomainError("DNS ainda não configurado. Verifique os registros abaixo.");
        }
      }
    } catch {
      setDomainError("Erro ao verificar domínio");
    } finally {
      setVerifyingDomain(false);
    }
  }

  async function handleRemoveDomain() {
    if (!workspace) return;
    setRemovingDomain(true);
    setDomainMessage("");
    setDomainError("");
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove_domain",
          workspace_id: workspace.id,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setDomainError(data.error);
      } else {
        setCustomDomain("");
        setCustomDomainInput("");
        setDomainVerified(false);
        setDomainVerification([]);
        setDomainMessage("Domínio removido com sucesso.");
      }
    } catch {
      setDomainError("Erro ao remover domínio");
    } finally {
      setRemovingDomain(false);
    }
  }

  // === VNDA handlers ===

  async function handleSaveVndaConnection() {
    if (!vndaToken || !vndaHost || !workspace) return;
    setSavingVnda(true);
    setVndaError("");
    setVndaSaved(false);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_vnda_connection",
          workspace_id: workspace.id,
          api_token: vndaToken,
          store_host: vndaHost,
          store_name: vndaName || vndaHost,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setVndaError(data.error);
      } else {
        setVndaSaved(true);
        setVndaToken("");
        setHasVndaConnection(true);
        await loadWorkspaceData();
      }
    } catch {
      setVndaError("Erro ao salvar conexão VNDA");
    } finally {
      setSavingVnda(false);
    }
  }

  async function handleTestVndaConnection() {
    const token = vndaToken || undefined;
    const host = vndaHost || vndaConnectionInfo?.store_host;
    if (!host || !workspace) return;

    // If no new token typed, we need to fetch from the API using saved connection
    if (!token && !hasVndaConnection) return;

    setTestingVnda(true);
    setVndaTestResult(null);
    try {
      if (token) {
        // Test with the token typed in the field
        const res = await fetch("/api/workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "test_vnda_connection",
            workspace_id: workspace.id,
            api_token: token,
            store_host: host,
          }),
        });
        setVndaTestResult(await res.json());
      } else {
        // Test by fetching 1 insight from saved connection
        const res = await fetch(`/api/vnda/insights?date_preset=last_7d`, {
          headers: { "x-workspace-id": workspace.id },
        });
        const data = await res.json();
        setVndaTestResult(data.configured
          ? { ok: true, message: `Conexão OK. ${data.totals?.orders || 0} pedidos nos últimos 7 dias.` }
          : { ok: false, message: data.error || "Não foi possível conectar" }
        );
      }
    } catch {
      setVndaTestResult({ ok: false, message: "Erro ao testar conexão" });
    } finally {
      setTestingVnda(false);
    }
  }

  async function handleDeleteVndaConnection() {
    if (!workspace) return;
    try {
      await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_vnda_connection",
          workspace_id: workspace.id,
        }),
      });
      setHasVndaConnection(false);
      setVndaConnectionInfo(null);
      setVndaTestResult(null);
    } catch {
      // Silent
    }
  }

  async function handleRegenerateWebhookToken() {
    if (!workspace) return;
    if (!confirm("Tem certeza? A URL antiga deixará de funcionar.")) return;
    setRegeneratingToken(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "regenerate_vnda_webhook_token",
          workspace_id: workspace.id,
        }),
      });
      const data = await res.json();
      if (data.webhook_token) {
        setVndaConnectionInfo((prev) => prev ? { ...prev, webhook_token: data.webhook_token } : prev);
      }
    } catch {
      // Silent
    } finally {
      setRegeneratingToken(false);
    }
  }

  function copyWebhookUrl() {
    const token = vndaConnectionInfo?.webhook_token;
    if (!token) return;
    const url = `${window.location.origin}/api/webhooks/vnda/orders?token=${token}`;
    navigator.clipboard.writeText(url);
    setWebhookCopied(true);
    setTimeout(() => setWebhookCopied(false), 2000);
  }

  // === Eccosys handlers ===

  async function handleTestEccosysConnection() {
    setTestingEccosys(true);
    setEccosysTestResult(null);
    try {
      const res = await fetch("/api/eccosys/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setEccosysTestResult(await res.json());
    } catch {
      setEccosysTestResult({ ok: false, message: "Erro ao testar conexao" });
    } finally {
      setTestingEccosys(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configurações do workspace e conexões
        </p>
      </div>

      <Tabs defaultValue={tabFromUrl && isAdmin ? tabFromUrl : isAdmin ? "meta" : "team"}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          {isAdmin && (
            <TabsTrigger value="meta">
              <Key className="h-4 w-4 mr-2" />
              Conexão Meta
            </TabsTrigger>
          )}
          <TabsTrigger value="team">
            <Users className="h-4 w-4 mr-2" />
            Equipe
          </TabsTrigger>
          <TabsTrigger value="workspace">
            <Building2 className="h-4 w-4 mr-2" />
            Workspace
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="vnda">
              <ShoppingBag className="h-4 w-4 mr-2" />
              VNDA
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="eccosys">
              <Settings className="h-4 w-4 mr-2" />
              Eccosys
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="health">
              <Activity className="h-4 w-4 mr-2" />
              Health Check
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="llm">
              <Cpu className="h-4 w-4 mr-2" />
              Provedor IA
            </TabsTrigger>
          )}
        </TabsList>

        {/* ===== Meta Connection Tab ===== */}
        <TabsContent value="meta" className="space-y-6 mt-6">
          {/* Token card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Token de Acesso Meta
              </CardTitle>
              <CardDescription>
                {hasConnection
                  ? "Conexão ativa. Insira um novo token para substituir."
                  : "Configure o token de acesso da Meta API para este workspace."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isAdmin ? (
                <p className="text-sm text-muted-foreground">
                  Apenas administradores podem gerenciar a conexão Meta.
                </p>
              ) : (
                <>
                  {hasConnection && connectionInfo && (
                    <div className="flex items-center gap-2 p-3 bg-success/10 rounded-lg mb-2">
                      <CheckCircle className="h-4 w-4 text-success" />
                      <span className="text-sm text-success">
                        Conexão ativa desde{" "}
                        {new Date(connectionInfo.created_at!).toLocaleDateString("pt-BR")}
                        {connectionInfo.app_id && ` (App: ${connectionInfo.app_id})`}
                      </span>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Access Token</Label>
                    <Input
                      type="password"
                      value={metaToken}
                      onChange={(e) => setMetaToken(e.target.value)}
                      placeholder={hasConnection ? "Novo token (deixe vazio para manter)" : "EAA..."}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>App ID (opcional)</Label>
                    <Input
                      value={metaAppId}
                      onChange={(e) => setMetaAppId(e.target.value)}
                      placeholder="ID do App Meta"
                    />
                  </div>

                  <Button
                    onClick={handleSaveMetaConnection}
                    disabled={!metaToken || savingToken}
                  >
                    {savingToken ? "Salvando..." : hasConnection ? "Atualizar Token" : "Salvar Conexão"}
                  </Button>

                  {tokenSaved && (
                    <div className="flex items-center gap-2 p-3 bg-success/10 rounded-lg">
                      <CheckCircle className="h-4 w-4 text-success" />
                      <span className="text-sm text-success">
                        Token salvo! Selecione as contas abaixo.
                      </span>
                    </div>
                  )}

                  {tokenError && (
                    <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg">
                      <XCircle className="h-4 w-4 text-destructive" />
                      <span className="text-sm text-destructive">{tokenError}</span>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Account selection card */}
          {isAdmin && hasConnection && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  Contas de Anúncio
                </CardTitle>
                <CardDescription>
                  Selecione quais contas o workspace terá acesso e defina a conta padrão
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Saved accounts summary */}
                {savedAccounts.length > 0 && allAccounts.length === 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Contas ativas ({savedAccounts.length})</p>
                    {savedAccounts.map((acc) => (
                      <div
                        key={acc.account_id}
                        className="flex items-center justify-between p-3 rounded-lg border border-border"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{acc.account_name || acc.account_id}</span>
                          {acc.is_default && (
                            <Badge variant="default" className="text-xs">
                              <Star className="h-3 w-3 mr-1" />
                              Padrão
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <Button
                  variant="outline"
                  onClick={handleFetchAllAccounts}
                  disabled={loadingAccounts}
                >
                  {loadingAccounts ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Buscando contas...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {allAccounts.length > 0 ? "Atualizar lista" : "Buscar contas da Meta"}
                    </>
                  )}
                </Button>

                {/* Full account list with checkboxes */}
                {allAccounts.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      {allAccounts.length} contas encontradas — selecione as que deseja usar:
                    </p>
                    <div className="space-y-1 max-h-80 overflow-y-auto">
                      {allAccounts.map((acc) => {
                        const isSelected = selectedIds.has(acc.id);
                        const isDefault = acc.id === defaultAccountId;
                        return (
                          <div
                            key={acc.id}
                            className={`flex items-center justify-between p-3 rounded-lg border transition-colors cursor-pointer ${
                              isSelected
                                ? "border-primary bg-primary/5"
                                : "border-border hover:bg-muted/50"
                            }`}
                            onClick={() => toggleAccountSelection(acc.id)}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleAccountSelection(acc.id)}
                                className="h-4 w-4 rounded border-border accent-primary"
                                onClick={(e) => e.stopPropagation()}
                              />
                              <div>
                                <p className="text-sm font-medium">{acc.name}</p>
                                <p className="text-xs text-muted-foreground">{acc.id}</p>
                              </div>
                            </div>
                            {isSelected && (
                              <Button
                                variant={isDefault ? "default" : "ghost"}
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSetDefault(acc.id);
                                }}
                                className="text-xs"
                              >
                                <Star className={`h-3 w-3 mr-1 ${isDefault ? "fill-current" : ""}`} />
                                {isDefault ? "Padrão" : "Definir padrão"}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-3 pt-3">
                      <Button
                        onClick={handleSaveSelectedAccounts}
                        disabled={savingAccounts || selectedIds.size === 0}
                      >
                        <Save className="h-4 w-4 mr-2" />
                        {savingAccounts
                          ? "Salvando..."
                          : `Salvar ${selectedIds.size} conta${selectedIds.size !== 1 ? "s" : ""}`}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {selectedIds.size} selecionada{selectedIds.size !== 1 ? "s" : ""}
                        {defaultAccountId && ` · 1 padrão`}
                      </span>
                    </div>

                    {accountsMessage && (
                      <div className="flex items-center gap-2 p-3 bg-success/10 rounded-lg">
                        <CheckCircle className="h-4 w-4 text-success" />
                        <span className="text-sm text-success">{accountsMessage}</span>
                      </div>
                    )}
                    {accountsError && (
                      <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg">
                        <XCircle className="h-4 w-4 text-destructive" />
                        <span className="text-sm text-destructive">{accountsError}</span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ===== Team Tab ===== */}
        <TabsContent value="team" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Membros da Equipe
              </CardTitle>
              <CardDescription>
                Gerencie quem tem acesso a este workspace
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Feedback messages */}
              {teamMessage && (
                <div className="flex items-center gap-2 p-3 bg-success/10 rounded-lg">
                  <CheckCircle className="h-4 w-4 text-success" />
                  <span className="text-sm text-success">{teamMessage}</span>
                </div>
              )}
              {teamError && (
                <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg">
                  <XCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm text-destructive">{teamError}</span>
                </div>
              )}

              {/* Members list */}
              <div className="space-y-2">
                {members.map((member) => (
                  <div
                    key={member.user_id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-sm font-medium text-primary">
                          {(member.profile?.full_name || "U")[0].toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {member.profile?.full_name || "Usuário"}
                          {member.user_id === user?.id && (
                            <span className="text-muted-foreground ml-1">(você)</span>
                          )}
                        </p>
                        {member.role === "owner" ? (
                          <Badge variant="secondary" className="text-xs">
                            owner
                          </Badge>
                        ) : isAdmin && member.user_id !== user?.id ? (
                          <select
                            value={member.role}
                            onChange={(e) => handleUpdateRole(member.user_id, e.target.value)}
                            className="rounded border border-border bg-background px-2 py-0.5 text-xs"
                          >
                            <option value="member">member</option>
                            <option value="admin">admin</option>
                          </select>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            {member.role}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {isAdmin && member.user_id !== user?.id && member.role !== "owner" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveMember(member.user_id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              {/* Pending invitations */}
              {isAdmin && pendingInvites.length > 0 && (
                <div className="pt-4 border-t border-border space-y-3">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    Convites Pendentes ({pendingInvites.length})
                  </p>
                  <div className="space-y-2">
                    {pendingInvites.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-dashed border-border"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-amber-500/10 flex items-center justify-center">
                            <Mail className="h-4 w-4 text-amber-500" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{inv.email}</p>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                                Pendente
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                {inv.role}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                Enviado {new Date(inv.created_at).toLocaleDateString("pt-BR")}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleResendInvite(inv.id)}
                            title="Reenviar convite"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCancelInvite(inv.id)}
                            title="Cancelar convite"
                          >
                            <XCircle className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Invite member */}
              {isAdmin && (
                <div className="pt-4 border-t border-border space-y-3">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <UserPlus className="h-4 w-4" />
                    Convidar Membro
                  </p>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="Email do usuário"
                      className="flex-1"
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                    >
                      <option value="member">Membro</option>
                      <option value="admin">Admin</option>
                    </select>
                    <Button
                      onClick={handleInviteMember}
                      disabled={!inviteEmail || inviting}
                    >
                      {inviting ? "Convidando..." : "Convidar"}
                    </Button>
                  </div>
                  {inviteRole === "member" && (
                    <div className="space-y-2 pl-1">
                      <p className="text-xs text-muted-foreground">
                        Funcionalidades que este membro tera acesso:
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {FEATURES.map((feature) => (
                          <label key={feature.id} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={inviteFeatures.includes(feature.id)}
                              onChange={(e) => {
                                setInviteFeatures((prev) =>
                                  e.target.checked
                                    ? [...prev, feature.id]
                                    : prev.filter((f) => f !== feature.id)
                                );
                              }}
                              className="h-4 w-4 rounded border-border accent-primary"
                            />
                            {feature.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Permissions per member */}
              {isAdmin && members.filter((m) => m.role === "member").length > 0 && (
                <div className="pt-4 border-t border-border space-y-3">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Permissoes por Membro
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Controle quais funcionalidades cada membro pode acessar.
                    Admins e owners sempre tem acesso total.
                  </p>
                  {members
                    .filter((m) => m.role === "member")
                    .map((member) => {
                      const memberFeatures = member.features ?? ALL_FEATURE_IDS;
                      return (
                        <div
                          key={member.user_id}
                          className="rounded-lg border border-border p-4 space-y-3"
                        >
                          <p className="text-sm font-medium">
                            {member.profile?.full_name || "Membro"}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {FEATURES.map((feature) => (
                              <div
                                key={feature.id}
                                className="flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm">{feature.label}</p>
                                  <p className="text-xs text-muted-foreground truncate">
                                    {feature.description}
                                  </p>
                                </div>
                                <Switch
                                  checked={memberFeatures.includes(feature.id)}
                                  onCheckedChange={(checked) => {
                                    handleToggleFeature(
                                      member.user_id,
                                      feature.id,
                                      checked
                                    );
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Workspace Tab ===== */}
        <TabsContent value="workspace" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Informações do Workspace
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {wsMessage && (
                <div className="flex items-center gap-2 p-3 bg-success/10 rounded-lg">
                  <CheckCircle className="h-4 w-4 text-success" />
                  <span className="text-sm text-success">{wsMessage}</span>
                </div>
              )}
              {wsError && (
                <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg">
                  <XCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm text-destructive">{wsError}</span>
                </div>
              )}

              {isAdmin ? (
                <>
                  <div className="space-y-2">
                    <Label>Nome</Label>
                    <Input
                      value={wsName}
                      onChange={(e) => setWsName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Slug</Label>
                    <Input
                      value={wsSlug}
                      onChange={(e) => setWsSlug(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                  <Button
                    onClick={handleSaveWorkspace}
                    disabled={savingWs}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {savingWs ? "Salvando..." : "Salvar Alterações"}
                  </Button>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Nome</Label>
                    <p className="text-sm">{workspace?.name || "—"}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Slug</Label>
                    <p className="text-sm font-mono text-muted-foreground">
                      {workspace?.slug || "—"}
                    </p>
                  </div>
                </>
              )}

              <div className="pt-4 border-t border-border grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Seu papel</Label>
                  <Badge variant="secondary">{userRole || "—"}</Badge>
                </div>
                <div className="space-y-1">
                  <Label>Membros</Label>
                  <p className="text-sm">{members.length}</p>
                </div>
                <div className="space-y-1">
                  <Label>Contas Meta ativas</Label>
                  <p className="text-sm">{savedAccounts.length}</p>
                </div>
                <div className="space-y-1">
                  <Label>Conta padrão</Label>
                  <p className="text-sm">
                    {savedAccounts.find((a) => a.is_default)?.account_name || "Nenhuma"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Custom Domain */}
          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5 text-blue-500" />
                  Domínio Customizado
                </CardTitle>
                <CardDescription>
                  Configure um domínio personalizado para acessar o dashboard (ex: dash.suaempresa.com.br)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {domainMessage && (
                  <div className="flex items-center gap-2 p-3 bg-success/10 rounded-lg">
                    <CheckCircle className="h-4 w-4 text-success" />
                    <span className="text-sm text-success">{domainMessage}</span>
                  </div>
                )}
                {domainError && (
                  <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg">
                    <XCircle className="h-4 w-4 text-destructive" />
                    <span className="text-sm text-destructive">{domainError}</span>
                  </div>
                )}

                {customDomain ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 space-y-1">
                        <Label>Domínio atual</Label>
                        <p className="text-sm font-mono bg-muted px-3 py-2 rounded-md">{customDomain}</p>
                      </div>
                      <Badge variant={domainVerified ? "default" : "secondary"}>
                        {domainVerified ? "Verificado" : "Pendente"}
                      </Badge>
                    </div>

                    <div className="space-y-3 p-4 border border-border rounded-lg bg-muted/50">
                      <p className="text-sm font-medium">
                        {domainVerified ? "Configuração de DNS (referência):" : "Configure o DNS do seu domínio:"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        No painel do seu provedor de DNS (Registro.br, Cloudflare, etc.), adicione o registro abaixo:
                      </p>
                      <div className="space-y-2">
                        <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                          <span className="text-muted-foreground">Tipo</span>
                          <span className="text-muted-foreground">Nome</span>
                          <span className="text-muted-foreground">Valor</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-sm font-mono bg-background p-2 rounded">
                          <span>CNAME</span>
                          <span>{customDomain.split(".")[0]}</span>
                          <span>cname.vercel-dns.com</span>
                        </div>
                        {domainVerification.map((v, i) => (
                          <div key={i} className="grid grid-cols-3 gap-2 text-sm font-mono bg-background p-2 rounded">
                            <span>{v.type}</span>
                            <span className="truncate">{v.domain}</span>
                            <span className="truncate">{v.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={handleVerifyDomain}
                        disabled={verifyingDomain}
                        variant="outline"
                      >
                        <RefreshCw className={`h-4 w-4 mr-2 ${verifyingDomain ? "animate-spin" : ""}`} />
                        {verifyingDomain ? "Verificando..." : "Verificar DNS"}
                      </Button>
                      <Button
                        onClick={handleRemoveDomain}
                        disabled={removingDomain}
                        variant="destructive"
                        size="sm"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        {removingDomain ? "Removendo..." : "Remover Domínio"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>Domínio</Label>
                      <Input
                        value={customDomainInput}
                        onChange={(e) => setCustomDomainInput(e.target.value)}
                        placeholder="dash.suaempresa.com.br"
                        className="font-mono"
                      />
                      <p className="text-xs text-muted-foreground">
                        Informe o subdomínio completo que deseja usar para acessar o dashboard.
                      </p>
                    </div>
                    <Button
                      onClick={handleSetDomain}
                      disabled={savingDomain || !customDomainInput}
                    >
                      <Globe className="h-4 w-4 mr-2" />
                      {savingDomain ? "Configurando..." : "Configurar Domínio"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ===== VNDA Tab ===== */}
        <TabsContent value="vnda" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-emerald-500" />
                Conexão VNDA E-commerce
              </CardTitle>
              <CardDescription>
                {hasVndaConnection
                  ? "Conexão ativa com a VNDA. Insira novos dados para substituir."
                  : "Configure o token da API VNDA para importar dados reais de pedidos e faturamento."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isAdmin ? (
                <p className="text-sm text-muted-foreground">
                  Apenas administradores podem gerenciar a conexão VNDA.
                </p>
              ) : (
                <>
                  {hasVndaConnection && vndaConnectionInfo && (
                    <div className="flex items-center justify-between p-3 bg-emerald-500/10 rounded-lg mb-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                        <span className="text-sm text-emerald-500">
                          Conectado a {vndaConnectionInfo.store_name || vndaConnectionInfo.store_host} desde{" "}
                          {new Date(vndaConnectionInfo.created_at!).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                      <Button variant="ghost" size="sm" onClick={handleDeleteVndaConnection} className="text-destructive hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Token da API</Label>
                    <Input
                      type="password"
                      value={vndaToken}
                      onChange={(e) => setVndaToken(e.target.value)}
                      placeholder={hasVndaConnection ? "Novo token (deixe vazio para manter)" : "Token gerado no Admin VNDA"}
                    />
                    <p className="text-xs text-muted-foreground">
                      Gere em: Admin VNDA &gt; Configurações &gt; Tokens de Desenvolvedor
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Host da Loja</Label>
                    <Input
                      value={vndaHost || vndaConnectionInfo?.store_host || ""}
                      onChange={(e) => setVndaHost(e.target.value)}
                      placeholder="www.sualoja.com.br"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Nome da Loja (opcional)</Label>
                    <Input
                      value={vndaName || vndaConnectionInfo?.store_name || ""}
                      onChange={(e) => setVndaName(e.target.value)}
                      placeholder="Minha Loja"
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={handleSaveVndaConnection}
                      disabled={(!vndaToken || !vndaHost) || savingVnda}
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {savingVnda ? "Salvando..." : hasVndaConnection ? "Atualizar Conexão" : "Salvar Conexão"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleTestVndaConnection}
                      disabled={testingVnda || (!vndaToken && !hasVndaConnection)}
                    >
                      {testingVnda ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Testando...
                        </>
                      ) : (
                        "Testar Conexão"
                      )}
                    </Button>
                  </div>

                  {vndaSaved && (
                    <div className="flex items-center gap-2 p-3 bg-emerald-500/10 rounded-lg">
                      <CheckCircle className="h-4 w-4 text-emerald-500" />
                      <span className="text-sm text-emerald-500">Conexão VNDA salva com sucesso!</span>
                    </div>
                  )}

                  {vndaError && (
                    <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg">
                      <XCircle className="h-4 w-4 text-destructive" />
                      <span className="text-sm text-destructive">{vndaError}</span>
                    </div>
                  )}

                  {vndaTestResult && (
                    <div className={`flex items-center gap-2 p-3 rounded-lg ${vndaTestResult.ok ? "bg-emerald-500/10" : "bg-destructive/10"}`}>
                      {vndaTestResult.ok ? (
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" />
                      )}
                      <span className={`text-sm ${vndaTestResult.ok ? "text-emerald-500" : "text-destructive"}`}>
                        {vndaTestResult.message}
                      </span>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Webhook URL Card */}
          {hasVndaConnection && isAdmin && vndaConnectionInfo?.webhook_token && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link className="h-5 w-5 text-blue-500" />
                  Webhook — Pedidos Confirmados
                </CardTitle>
                <CardDescription>
                  Configure esta URL no Admin VNDA &gt; Integrações &gt; Webhooks &gt; Pedido Confirmado.
                  Cada pedido confirmado será inserido automaticamente no CRM.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>URL do Webhook</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={`${typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/vnda/orders?token=${vndaConnectionInfo.webhook_token}`}
                      className="font-mono text-xs"
                    />
                    <Button variant="outline" size="icon" onClick={copyWebhookUrl} title="Copiar URL">
                      {webhookCopied ? <CheckCircle className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRegenerateWebhookToken}
                    disabled={regeneratingToken}
                  >
                    <RotateCcw className={`h-4 w-4 mr-2 ${regeneratingToken ? "animate-spin" : ""}`} />
                    {regeneratingToken ? "Regenerando..." : "Regenerar Token"}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    A URL anterior será invalidada.
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ===== Eccosys Tab ===== */}
        <TabsContent value="eccosys" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-orange-500" />
                Conexao Eccosys ERP
              </CardTitle>
              <CardDescription>
                Token configurado diretamente nas variaveis de ambiente da Vercel para maxima seguranca.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Status */}
              <div className={`flex items-center gap-2 p-3 rounded-lg ${eccosysConfigured ? "bg-orange-500/10" : "bg-destructive/10"}`}>
                {eccosysConfigured ? (
                  <CheckCircle className="h-4 w-4 text-orange-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <span className={`text-sm ${eccosysConfigured ? "text-orange-600 dark:text-orange-400" : "text-destructive"}`}>
                  {eccosysConfigured
                    ? <>Token configurado · Ambiente: <strong>{eccosysAmbiente}</strong></>
                    : "Token nao configurado"}
                </span>
              </div>

              {/* Test button — always visible for admins */}
              {isAdmin && (
                <Button
                  variant="outline"
                  onClick={handleTestEccosysConnection}
                  disabled={testingEccosys}
                >
                  {testingEccosys ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Testando...
                    </>
                  ) : (
                    "Testar Conexao"
                  )}
                </Button>
              )}

              {eccosysTestResult && (
                <div className={`flex items-center gap-2 p-3 rounded-lg ${eccosysTestResult.ok ? "bg-success/10" : "bg-destructive/10"}`}>
                  {eccosysTestResult.ok ? (
                    <CheckCircle className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span className={`text-sm ${eccosysTestResult.ok ? "text-success" : "text-destructive"}`}>
                    {eccosysTestResult.message}
                  </span>
                </div>
              )}

              {/* Instructions */}
              <div className="rounded-lg bg-muted/50 p-4 text-xs text-muted-foreground space-y-2">
                <p className="font-medium text-sm text-foreground">Como configurar:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>
                    Acesse o painel da Vercel &gt; Settings &gt; Environment Variables
                  </li>
                  <li>
                    Adicione <code className="bg-muted px-1 rounded">ECCOSYS_API_TOKEN</code> com o Bearer token
                  </li>
                  <li>
                    Adicione <code className="bg-muted px-1 rounded">ECCOSYS_AMBIENTE</code> com o valor{" "}
                    <code className="bg-muted px-1 rounded">producao</code>,{" "}
                    <code className="bg-muted px-1 rounded">homolog</code> ou{" "}
                    <code className="bg-muted px-1 rounded">sandbox</code>
                  </li>
                  <li>Faca um redeploy para aplicar as variaveis</li>
                </ol>
                <p className="pt-1">
                  O token nunca toca o banco de dados — fica encriptado nos servidores da Vercel.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Health Check Tab ===== */}
        <TabsContent value="health" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                Status do Sistema
              </CardTitle>
              <CardDescription>
                Verifique a conexão com a API da Meta
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={handleHealthCheck}
                disabled={healthLoading}
              >
                {healthLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Verificando...
                  </>
                ) : (
                  "Executar Health Check"
                )}
              </Button>

              {healthResult && (
                <div className="space-y-3 p-4 bg-muted rounded-lg">
                  <div className="flex items-center gap-2">
                    {healthResult.error ? (
                      <XCircle className="h-5 w-5 text-destructive" />
                    ) : (
                      <CheckCircle className="h-5 w-5 text-success" />
                    )}
                    <span className="text-sm font-medium">
                      {healthResult.error
                        ? "Erro na conexão"
                        : "Conexão estabelecida"}
                    </span>
                  </div>
                  <pre className="text-xs whitespace-pre-wrap overflow-auto max-h-48 text-muted-foreground">
                    {JSON.stringify(healthResult, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        {/* ===== LLM Provider Tab ===== */}
        <TabsContent value="llm" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-5 w-5 text-primary" />
                Provedor de IA
              </CardTitle>
              <CardDescription>
                Escolha entre Anthropic (direto) ou OpenRouter (mais econômico, múltiplos modelos).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Provider Toggle */}
              <div className="space-y-2">
                <Label>Provedor</Label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setLlmProvider("anthropic")}
                    className={`flex-1 rounded-lg border p-4 text-left transition-colors cursor-pointer ${
                      llmProvider === "anthropic"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="font-semibold text-sm">Anthropic (Direto)</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Máxima qualidade. Claude Opus, Sonnet e Haiku direto da API.
                    </div>
                  </button>
                  <button
                    onClick={() => setLlmProvider("openrouter")}
                    className={`flex-1 rounded-lg border p-4 text-left transition-colors cursor-pointer ${
                      llmProvider === "openrouter"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="font-semibold text-sm">OpenRouter (Auto)</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Roteador automatico. Analisa o contexto e seleciona o melhor modelo (Claude, GPT, DeepSeek, Gemini).
                    </div>
                  </button>
                </div>
              </div>

              {/* Allowed Models (only for OpenRouter) */}
              {llmProvider === "openrouter" && (
                <div className="space-y-4 border-t border-border pt-4">
                  <div>
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Modelos Permitidos (opcional)
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Restrinja quais modelos o roteador pode escolher. Deixe vazio para permitir todos.
                      Um modelo por linha. Suporta glob: <code className="text-[10px] bg-muted px-1 rounded">deepseek/*</code>
                    </p>
                  </div>
                  <textarea
                    value={allowedModels}
                    onChange={(e) => setAllowedModels(e.target.value)}
                    placeholder={"anthropic/claude-sonnet-4.6\ndeepseek/deepseek-chat\ngoogle/gemini-2.5-flash\nanthropic/claude-haiku-4.5"}
                    rows={5}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}

              {/* Save Button */}
              <div className="flex items-center gap-3">
                <Button
                  onClick={async () => {
                    if (!workspace?.id) return;
                    setSavingProvider(true);
                    setProviderError("");
                    setProviderSaved(false);
                    try {
                      const allowedList = allowedModels
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean);
                      const config = {
                        provider: llmProvider,
                        ...(llmProvider === "openrouter" && allowedList.length > 0
                          ? { allowedModels: allowedList }
                          : {}),
                      };
                      const res = await fetch("/api/agent/config", {
                        method: "PUT",
                        headers: {
                          "Content-Type": "application/json",
                          "x-workspace-id": workspace.id,
                        },
                        body: JSON.stringify({
                          doc_type: "provider_config",
                          content: JSON.stringify(config),
                        }),
                      });
                      if (!res.ok) throw new Error("Falha ao salvar");
                      setProviderSaved(true);
                      setTimeout(() => setProviderSaved(false), 3000);
                    } catch {
                      setProviderError("Erro ao salvar configuração.");
                    } finally {
                      setSavingProvider(false);
                    }
                  }}
                  disabled={savingProvider}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {savingProvider ? "Salvando..." : "Salvar Provedor"}
                </Button>
                {providerSaved && (
                  <span className="text-sm text-success flex items-center gap-1">
                    <CheckCircle className="h-4 w-4" /> Salvo!
                  </span>
                )}
                {providerError && (
                  <span className="text-sm text-destructive">{providerError}</span>
                )}
              </div>

              {/* Info Box */}
              <div className="rounded-lg bg-muted/50 p-4 text-xs text-muted-foreground space-y-1">
                <p><strong>Anthropic:</strong> Requer ANTHROPIC_API_KEY no .env</p>
                <p><strong>OpenRouter:</strong> Requer OPENROUTER_API_KEY no .env — o roteador automatico analisa cada prompt e escolhe o modelo ideal</p>
                <p>Use &quot;Modelos Permitidos&quot; para limitar o pool e controlar custos (ex: apenas deepseek/* e gemini)</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

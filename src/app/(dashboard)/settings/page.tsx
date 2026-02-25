"use client";

import React, { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth-context";

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

  // Workspace edit
  const [wsName, setWsName] = useState("");
  const [wsSlug, setWsSlug] = useState("");
  const [savingWs, setSavingWs] = useState(false);
  const [wsMessage, setWsMessage] = useState("");
  const [wsError, setWsError] = useState("");

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
    } catch {
      // Silent
    }
  }, [workspace?.id]);

  useEffect(() => {
    loadWorkspaceData();
  }, [loadWorkspaceData]);

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
        }),
      });
      const data = await res.json();
      if (data.error) {
        setTeamError(data.error);
      } else {
        setTeamMessage("Membro convidado com sucesso!");
        setInviteEmail("");
        refreshMembers();
      }
    } catch {
      setTeamError("Erro ao convidar membro");
    } finally {
      setInviting(false);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configurações do workspace e conexões
        </p>
      </div>

      <Tabs defaultValue="meta">
        <TabsList>
          <TabsTrigger value="meta">
            <Key className="h-4 w-4 mr-2" />
            Conexão Meta
          </TabsTrigger>
          <TabsTrigger value="team">
            <Users className="h-4 w-4 mr-2" />
            Equipe
          </TabsTrigger>
          <TabsTrigger value="workspace">
            <Building2 className="h-4 w-4 mr-2" />
            Workspace
          </TabsTrigger>
          <TabsTrigger value="health">
            <Activity className="h-4 w-4 mr-2" />
            Health Check
          </TabsTrigger>
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
      </Tabs>
    </div>
  );
}

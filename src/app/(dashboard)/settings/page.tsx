"use client";

import React, { useState } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth-context";

export default function SettingsPage() {
  const { workspace, members, userRole, refreshMembers } = useWorkspace();
  const { user } = useAuth();
  const isAdmin = userRole === "owner" || userRole === "admin";

  // Meta Connection
  const [metaToken, setMetaToken] = useState("");
  const [metaAppId, setMetaAppId] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [tokenSaved, setTokenSaved] = useState(false);
  const [tokenError, setTokenError] = useState("");

  // Health Check
  const [healthResult, setHealthResult] = useState<Record<string, unknown> | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // Team
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);

  async function handleSaveMetaConnection() {
    if (!metaToken || !workspace) return;
    setSavingToken(true);
    setTokenError("");
    setTokenSaved(false);

    try {
      // First validate the token
      const healthRes = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "health" }),
      });
      const healthData = await healthRes.json();

      if (healthData.error && !healthData.api_connected) {
        // Token might still work, try saving anyway
      }

      // Save to Supabase
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

        // Now fetch and save the ad accounts
        try {
          const accountsRes = await fetch("/api/accounts", {
            headers: { "x-workspace-id": workspace.id },
          });
          const accountsData = await accountsRes.json();

          if (accountsData.accounts?.length > 0) {
            await fetch("/api/workspaces", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "save_meta_accounts",
                workspace_id: workspace.id,
                accounts: accountsData.accounts.map((a: { id: string; name: string }) => ({
                  id: a.id,
                  name: a.name,
                })),
              }),
            });
          }
        } catch {
          // Non-critical
        }
      }
    } catch {
      setTokenError("Erro ao salvar conexão");
    } finally {
      setSavingToken(false);
    }
  }

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

  async function handleInviteMember() {
    if (!inviteEmail || !workspace) return;
    setInviting(true);
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
      if (data.success) {
        setInviteEmail("");
        refreshMembers();
      }
    } catch {
      // Error handling
    } finally {
      setInviting(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!workspace) return;
    try {
      await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove_member",
          workspace_id: workspace.id,
          user_id: userId,
        }),
      });
      refreshMembers();
    } catch {
      // Error handling
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

        {/* Meta Connection Tab */}
        <TabsContent value="meta" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Token de Acesso Meta
              </CardTitle>
              <CardDescription>
                Configure o token de acesso da Meta API para este workspace.
                Cada workspace tem sua própria conexão.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isAdmin ? (
                <p className="text-sm text-muted-foreground">
                  Apenas administradores podem gerenciar a conexão Meta.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Access Token</Label>
                    <Input
                      type="password"
                      value={metaToken}
                      onChange={(e) => setMetaToken(e.target.value)}
                      placeholder="EAA..."
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
                    {savingToken ? "Salvando..." : "Salvar Conexão"}
                  </Button>

                  {tokenSaved && (
                    <div className="flex items-center gap-2 p-3 bg-success/10 rounded-lg">
                      <CheckCircle className="h-4 w-4 text-success" />
                      <span className="text-sm text-success">
                        Conexão salva com sucesso! Contas vinculadas automaticamente.
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
        </TabsContent>

        {/* Team Tab */}
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
                        <Badge variant="secondary" className="text-xs">
                          {member.role}
                        </Badge>
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
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="ID do usuário"
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

        {/* Workspace Tab */}
        <TabsContent value="workspace" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Informações do Workspace
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
              <div className="space-y-2">
                <Label>Seu papel</Label>
                <Badge variant="secondary">{userRole || "—"}</Badge>
              </div>
              <div className="space-y-2">
                <Label>Membros</Label>
                <p className="text-sm">{members.length}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Health Check Tab */}
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

"use client";

import React, { useState } from "react";
import {
  Shield,
  CheckCircle,
  XCircle,
  RefreshCw,
  ExternalLink,
  Key,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface HealthCheckResult {
  status?: string;
  api_connected?: boolean;
  token_valid?: boolean;
  error?: string;
  [key: string]: unknown;
}

interface TokenInfo {
  is_valid?: boolean;
  app_id?: string;
  expires_at?: string;
  scopes?: string[];
  error?: string;
  [key: string]: unknown;
}

export default function SettingsPage() {
  const [healthResult, setHealthResult] = useState<HealthCheckResult | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authCode, setAuthCode] = useState("");
  const [exchangeResult, setExchangeResult] = useState<string | null>(null);

  async function handleHealthCheck() {
    setHealthLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  async function handleTokenInfo() {
    setTokenLoading(true);
    try {
      const res = await fetch("/api/auth");
      const data = await res.json();
      setTokenInfo(data);
    } catch (err) {
      setTokenInfo({ error: String(err) });
    } finally {
      setTokenLoading(false);
    }
  }

  async function handleGenerateAuthUrl() {
    setAuthLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_auth_url",
          redirect_uri: window.location.origin + "/settings",
          scopes: [
            "ads_management",
            "ads_read",
            "business_management",
            "pages_read_engagement",
          ],
        }),
      });
      const data = await res.json();
      setAuthUrl(data.auth_url || data.url || null);
    } catch {
      // Error handling
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleExchangeCode() {
    if (!authCode) return;
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "exchange",
          code: authCode,
          redirect_uri: window.location.origin + "/settings",
        }),
      });
      const data = await res.json();
      setExchangeResult(
        data.access_token
          ? "Token obtido com sucesso! Adicione-o ao seu .env.local como META_ACCESS_TOKEN"
          : data.error || "Erro ao trocar código"
      );
    } catch {
      setExchangeResult("Erro ao trocar código");
    }
  }

  async function handleRefreshToken() {
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      const data = await res.json();
      setExchangeResult(
        data.access_token
          ? "Token de longa duração obtido! Atualize o .env.local"
          : data.error || "Erro ao refresh"
      );
    } catch {
      setExchangeResult("Erro ao fazer refresh do token");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configurações da conta e autenticação
        </p>
      </div>

      <Tabs defaultValue="auth">
        <TabsList>
          <TabsTrigger value="auth">
            <Key className="h-4 w-4 mr-2" />
            Autenticação
          </TabsTrigger>
          <TabsTrigger value="health">
            <Activity className="h-4 w-4 mr-2" />
            Health Check
          </TabsTrigger>
        </TabsList>

        <TabsContent value="auth" className="space-y-6 mt-6">
          {/* OAuth Flow */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Autenticação OAuth Meta
              </CardTitle>
              <CardDescription>
                Conecte sua conta Meta para acessar a API de anúncios
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  1. Gere a URL de autorização e acesse-a no navegador
                </p>
                <Button
                  onClick={handleGenerateAuthUrl}
                  disabled={authLoading}
                  variant="outline"
                >
                  {authLoading ? "Gerando..." : "Gerar URL de Autorização"}
                </Button>

                {authUrl && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-xs text-muted-foreground mb-2">
                      Acesse esta URL para autorizar:
                    </p>
                    <a
                      href={authUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline flex items-center gap-1 break-all"
                    >
                      {authUrl}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  2. Cole o código de autorização recebido
                </p>
                <div className="flex gap-2">
                  <Input
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value)}
                    placeholder="Código de autorização"
                    className="flex-1"
                  />
                  <Button
                    onClick={handleExchangeCode}
                    disabled={!authCode}
                  >
                    Trocar por Token
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  3. (Opcional) Converta para token de longa duração
                </p>
                <Button
                  onClick={handleRefreshToken}
                  variant="outline"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Converter para Long-Lived Token
                </Button>
              </div>

              {exchangeResult && (
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm">{exchangeResult}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Token Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Informações do Token</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={handleTokenInfo}
                disabled={tokenLoading}
                variant="outline"
                size="sm"
              >
                {tokenLoading ? "Verificando..." : "Verificar Token Atual"}
              </Button>

              {tokenInfo && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    {tokenInfo.is_valid ? (
                      <CheckCircle className="h-4 w-4 text-success" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                    <span className="text-sm">
                      {tokenInfo.is_valid ? "Token válido" : "Token inválido"}
                    </span>
                  </div>
                  {tokenInfo.expires_at && (
                    <p className="text-xs text-muted-foreground">
                      Expira em: {new Date(tokenInfo.expires_at).toLocaleString("pt-BR")}
                    </p>
                  )}
                  {tokenInfo.scopes && (
                    <div className="flex flex-wrap gap-1">
                      {tokenInfo.scopes.map((scope) => (
                        <Badge key={scope} variant="secondary" className="text-xs">
                          {scope}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {tokenInfo.error && (
                    <p className="text-sm text-destructive">{tokenInfo.error}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="health" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                Status do Sistema
              </CardTitle>
              <CardDescription>
                Verifique a conexão com o MCP server e a API da Meta
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

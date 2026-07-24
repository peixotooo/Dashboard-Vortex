"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function rateLimitMessage(retryAfter: unknown): string {
    const seconds = typeof retryAfter === "number" ? retryAfter : 0;
    if (seconds < 1) return "Muitas tentativas. Aguarde e tente novamente.";
    if (seconds < 60) {
      return `Muitas tentativas. Aguarde ${Math.ceil(seconds)} segundos e tente novamente.`;
    }
    const minutes = Math.ceil(seconds / 60);
    return `Muitas tentativas. Aguarde cerca de ${minutes} minuto${minutes === 1 ? "" : "s"} e tente novamente.`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timeout));
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        retry_after?: number;
      };

      if (!response.ok) {
        setError(
          response.status === 429
            ? rateLimitMessage(data.retry_after)
            : data.error || "Erro ao fazer login. Tente novamente."
        );
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setError("Conexão lenta com o servidor. Tente entrar novamente em alguns segundos.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <span className="text-2xl font-bold text-primary">V</span>
        </div>
        <CardTitle className="text-2xl">Dashboard Vortex</CardTitle>
        <CardDescription>
          Entre com sua conta para acessar o dashboard
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div
              className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
              aria-live="polite"
            >
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              required
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Senha</Label>
              <Button
                variant="link"
                className="h-auto p-0 text-xs font-normal"
                onClick={() => router.push("/forgot-password")}
                type="button"
              >
                Esqueci minha senha
              </Button>
            </div>
            <Input
              id="password"
              type="password"
              placeholder="Sua senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              maxLength={1024}
              required
            />
          </div>


          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Acesso apenas por convite
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

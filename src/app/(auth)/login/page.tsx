"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
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
  const supabase = createClient();

  // Falhas passageiras (timeout/abort do nosso wrapper de fetch, rede instável,
  // saturação 504/522 do Supabase) — vale uma nova tentativa automática.
  function isTransient(message: string): boolean {
    const m = (message || "").toLowerCase();
    return (
      m.includes("aborted") ||
      m.includes("timeout") ||
      m.includes("timed out") ||
      m.includes("failed to fetch") ||
      m.includes("load failed") ||
      m.includes("networkerror") ||
      m.includes("network error") ||
      m.includes("502") ||
      m.includes("503") ||
      m.includes("504") ||
      m.includes("522")
    );
  }

  // Traduz o erro cru do Supabase para algo claro em português.
  function friendlyError(message: string): string {
    const m = (message || "").toLowerCase();
    if (m.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
    if (m.includes("email not confirmed")) return "E-mail ainda não confirmado.";
    if (m.includes("too many requests") || m.includes("rate limit"))
      return "Muitas tentativas. Aguarde um instante e tente de novo.";
    if (isTransient(message))
      return "Conexão lenta com o servidor. Tente entrar novamente em alguns segundos.";
    return message || "Erro ao fazer login. Tente novamente.";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      let { error } = await supabase.auth.signInWithPassword({ email, password });

      // Uma nova tentativa automática quando a 1ª falhou por motivo passageiro.
      if (error && isTransient(error.message)) {
        await new Promise((r) => setTimeout(r, 1200));
        ({ error } = await supabase.auth.signInWithPassword({ email, password }));
      }

      if (error) {
        setError(friendlyError(error.message));
        return;
      }

      router.push("/");
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : ""));
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
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
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

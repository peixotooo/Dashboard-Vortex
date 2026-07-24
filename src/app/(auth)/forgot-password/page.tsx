"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function rateLimitMessage(retryAfter: unknown): string {
    const seconds = typeof retryAfter === "number" ? retryAfter : 0;
    if (seconds < 60) return "Muitas solicitações. Aguarde um instante e tente novamente.";
    const minutes = Math.ceil(seconds / 60);
    return `Muitas solicitações. Aguarde cerca de ${minutes} minuto${minutes === 1 ? "" : "s"} e tente novamente.`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      const response = await fetch("/api/auth/recover", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timeout));
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        retry_after?: number;
      };

      if (!response.ok) {
        setError(
          response.status === 429
            ? rateLimitMessage(data.retry_after)
            : data.error || "Erro ao processar solicitação. Tente novamente."
        );
        return;
      }

      setMessage(
        data.message ||
          "Se o e-mail estiver cadastrado, você receberá um link de recuperação em instantes."
      );
    } catch {
      setError("Erro ao processar solicitação. Tente novamente.");
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
        <CardTitle className="text-2xl">Recuperar Senha</CardTitle>
        <CardDescription>
          Informe seu e-mail para receber um link de redefinição
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
          {message && (
            <div
              className="rounded-lg bg-primary/10 p-3 text-sm text-primary"
              role="status"
              aria-live="polite"
            >
              {message}
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

          <Button type="submit" className="w-full" disabled={loading || !!message}>
            {loading ? "Enviando..." : "Enviar link de recuperação"}
          </Button>

          <Button
            variant="ghost"
            className="w-full"
            onClick={() => router.push("/login")}
            type="button"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar para o login
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

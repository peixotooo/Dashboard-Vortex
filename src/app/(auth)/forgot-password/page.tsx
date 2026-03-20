"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
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
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: "https://dashboard-vortex.vercel.app/auth/callback?type=recovery",
      });

      if (error) {
        setError(error.message);
        return;
      }

      setMessage("Se o e-mail estiver cadastrado, você receberá um link de recuperação em instantes.");
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
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {message && (
            <div className="rounded-lg bg-primary/10 p-3 text-sm text-primary">
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

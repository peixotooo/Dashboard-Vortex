"use client";

// Style guide vivo do design system Vortex 2026.
// Página estática (nenhum dado de workspace) — serve de referência visual
// para o time e de superfície de verificação do tema claro/escuro.

import React from "react";
import { useTheme } from "next-themes";
import {
  Zap,
  Sun,
  Moon,
  TrendingUp,
  TrendingDown,
  Sparkles,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const TOKEN_SWATCHES = [
  { name: "background", cls: "bg-background border" },
  { name: "card", cls: "bg-card border" },
  { name: "muted", cls: "bg-muted" },
  { name: "accent", cls: "bg-accent" },
  { name: "primary", cls: "bg-primary" },
  { name: "success", cls: "bg-success" },
  { name: "warning", cls: "bg-warning" },
  { name: "info", cls: "bg-info" },
  { name: "destructive", cls: "bg-destructive" },
];

const CHART_BARS = [
  { label: "chart-1", h: "h-24" },
  { label: "chart-2", h: "h-16" },
  { label: "chart-3", h: "h-20" },
  { label: "chart-4", h: "h-12" },
  { label: "chart-5", h: "h-8" },
];

const SAMPLE_ROWS = [
  { sku: "775846220", nome: "Oversized Hustle III", receita: "R$ 48.230", var: "+12,4%", up: true },
  { sku: "775846231", nome: "Regata Dry Brasil", receita: "R$ 31.980", var: "-3,1%", up: false },
  { sku: "775846244", nome: "Camiseta Darkside", receita: "R$ 27.415", var: "+8,7%", up: true },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <TooltipProvider>
      <div className="relative min-h-screen overflow-x-clip bg-background">
        <div className="relative mx-auto max-w-5xl space-y-12 px-6 py-16">
          {/* Hero */}
          <header className="flex flex-wrap items-end justify-between gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-primary text-primary-foreground">
                  <Zap className="size-5" />
                </div>
                <Badge>Design System 2026</Badge>
              </div>
              <h1 className="text-4xl font-semibold tracking-tight">
                Vortex <span className="text-gradient">OS</span>
              </h1>
              <p className="max-w-lg text-sm text-muted-foreground">
                Tokens, tipografia e componentes do dashboard — ultra-minimal,
                monocromático, hairlines de 1px, paleta de gráficos validada
                para contraste e daltonismo nos dois temas.
              </p>
            </div>
            {mounted && (
              <Button
                variant="outline"
                onClick={() =>
                  setTheme(resolvedTheme === "dark" ? "light" : "dark")
                }
              >
                {resolvedTheme === "dark" ? (
                  <Sun className="mr-2 size-4" />
                ) : (
                  <Moon className="mr-2 size-4" />
                )}
                Tema {resolvedTheme === "dark" ? "claro" : "escuro"}
              </Button>
            )}
          </header>

          {/* Tokens */}
          <Section title="Cores — tokens">
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-9">
              {TOKEN_SWATCHES.map((s) => (
                <div key={s.name} className="space-y-1.5">
                  <div className={`h-14 rounded-lg ${s.cls}`} />
                  <p className="text-[11px] text-muted-foreground">{s.name}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* Tipografia */}
          <Section title="Tipografia">
            <Card>
              <CardContent className="grid gap-6 p-6 sm:grid-cols-3">
                <div>
                  <p className="text-3xl font-semibold tracking-tight">Inter</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Títulos — semibold, tracking apertado
                  </p>
                </div>
                <div>
                  <p className="text-3xl font-normal">Inter</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Corpo e interface — uma família só
                  </p>
                </div>
                <div>
                  <p className="font-mono text-3xl tabular-nums">R$ 48.230</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    JetBrains Mono — código e dados
                  </p>
                </div>
              </CardContent>
            </Card>
          </Section>

          {/* KPI cards */}
          <Section title="Cards de métrica">
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Receita (30d)</CardDescription>
                  <CardTitle className="text-3xl tabular-nums">
                    R$ 512.4k
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="flex items-center gap-1 text-xs text-success">
                    <TrendingUp className="size-3.5" /> +18,2% vs mês anterior
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>MER</CardDescription>
                  <CardTitle className="text-3xl tabular-nums">2,4x</CardTitle>
                </CardHeader>
                <CardContent>
                  <Progress value={68} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>CAC</CardDescription>
                  <CardTitle className="text-3xl tabular-nums">R$ 42</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="flex items-center gap-1 text-xs text-destructive">
                    <TrendingDown className="size-3.5" /> -4,1% vs meta
                  </p>
                </CardContent>
              </Card>
            </div>
          </Section>

          {/* Paleta de gráficos */}
          <Section title="Paleta de gráficos (CVD-safe)">
            <Card>
              <CardContent className="p-6">
                <div className="flex h-28 items-end gap-4">
                  {CHART_BARS.map((b, i) => (
                    <div key={b.label} className="flex flex-1 flex-col items-center gap-2">
                      <div
                        className={`w-full rounded-t-md ${b.h}`}
                        style={{ background: `var(--chart-${i + 1})` }}
                      />
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {b.label}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </Section>

          {/* Botões e badges */}
          <Section title="Botões & badges">
            <div className="flex flex-wrap items-center gap-3">
              <Button>
                <Sparkles className="mr-2 size-4" /> Primário
              </Button>
              <Button variant="secondary">Secundário</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destrutivo</Button>
              <Button variant="link">Link</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="success">Sucesso</Badge>
              <Badge variant="warning">Alerta</Badge>
              <Badge variant="destructive">Erro</Badge>
            </div>
          </Section>

          {/* Formulário */}
          <Section title="Formulário">
            <Card>
              <CardContent className="grid gap-6 p-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ds-nome">Nome da campanha</Label>
                  <Input id="ds-nome" placeholder="Ex.: Evergreen prospecção" />
                </div>
                <div className="space-y-2">
                  <Label>Objetivo</Label>
                  <Select defaultValue="vendas">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vendas">Vendas</SelectItem>
                      <SelectItem value="trafego">Tráfego</SelectItem>
                      <SelectItem value="alcance">Alcance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3">
                  <Switch id="ds-ativo" defaultChecked />
                  <Label htmlFor="ds-ativo">Campanha ativa</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline">Abrir dialog</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Overlay premium</DialogTitle>
                        <DialogDescription>
                          Backdrop com blur, cantos 2xl e sombra em camadas.
                        </DialogDescription>
                      </DialogHeader>
                    </DialogContent>
                  </Dialog>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <Info className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Tooltip de alto contraste</TooltipContent>
                  </Tooltip>
                </div>
              </CardContent>
            </Card>
          </Section>

          {/* Tabs + tabela */}
          <Section title="Tabs & tabela">
            <Tabs defaultValue="produtos">
              <TabsList>
                <TabsTrigger value="produtos">Produtos</TabsTrigger>
                <TabsTrigger value="pedidos">Pedidos</TabsTrigger>
                <TabsTrigger value="clientes">Clientes</TabsTrigger>
              </TabsList>
              <TabsContent value="produtos">
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-6">SKU</TableHead>
                          <TableHead>Produto</TableHead>
                          <TableHead className="text-right">Receita</TableHead>
                          <TableHead className="pr-6 text-right">Variação</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {SAMPLE_ROWS.map((r) => (
                          <TableRow key={r.sku}>
                            <TableCell className="pl-6 font-mono text-xs text-muted-foreground">
                              {r.sku}
                            </TableCell>
                            <TableCell className="font-medium">{r.nome}</TableCell>
                            <TableCell className="text-right">{r.receita}</TableCell>
                            <TableCell
                              className={`pr-6 text-right font-medium ${
                                r.up ? "text-success" : "text-destructive"
                              }`}
                            >
                              {r.var}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="pedidos">
                <Card>
                  <CardContent className="space-y-3 p-6">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-3/4" />
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="clientes">
                <Card>
                  <CardContent className="p-6 text-sm text-muted-foreground">
                    Conteúdo de exemplo.
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </Section>

          {/* Callouts */}
          <Section title="Callouts (regra dura de contraste)">
            <div className="grid gap-3 sm:grid-cols-2">
              <Callout tone="amber">
                Faixa de alerta: fundo 100 + texto 900 — sempre legível.
              </Callout>
              <Callout tone="emerald">
                Sucesso: mesmo padrão de contraste nos dois temas.
              </Callout>
              <Callout tone="red">Erro: nunca claro sobre claro.</Callout>
              <Callout tone="blue">Informativo: par 100/900 + dark 950/100.</Callout>
            </div>
          </Section>

          <footer className="border-t pt-6 text-xs text-muted-foreground">
            Vortex Design System · Tailwind v4 · tokens em{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono">
              src/app/globals.css
            </code>
          </footer>
        </div>
      </div>
    </TooltipProvider>
  );
}

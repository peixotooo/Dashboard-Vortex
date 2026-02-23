"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Plus, Users, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumber } from "@/lib/utils";
import type { Audience } from "@/lib/types";

export default function AudiencesPage() {
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState("custom");

  // Custom audience form
  const [customForm, setCustomForm] = useState({
    name: "",
    description: "",
    subtype: "CUSTOM",
    customer_file_source: "USER_PROVIDED_ONLY",
  });

  // Lookalike form
  const [lookalikeForm, setLookalikeForm] = useState({
    name: "",
    source_audience_id: "",
    country: "BR",
    ratio: "0.01",
  });

  // Estimate form
  const [estimateForm, setEstimateForm] = useState({
    countries: "BR",
    age_min: "18",
    age_max: "65",
  });
  const [estimateResult, setEstimateResult] = useState<string | null>(null);

  const fetchAudiences = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/audiences");
      const data = await res.json();
      setAudiences(data.audiences || []);
    } catch {
      // Keep empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAudiences();
  }, [fetchAudiences]);

  async function handleCreateCustom() {
    if (!customForm.name) return;
    setCreating(true);
    try {
      await fetch("/api/audiences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "custom", ...customForm }),
      });
      setCreateOpen(false);
      await fetchAudiences();
    } catch {
      // Error handling
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateLookalike() {
    if (!lookalikeForm.name || !lookalikeForm.source_audience_id) return;
    setCreating(true);
    try {
      await fetch("/api/audiences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "lookalike",
          name: lookalikeForm.name,
          source_audience_id: lookalikeForm.source_audience_id,
          country: lookalikeForm.country,
          ratio: parseFloat(lookalikeForm.ratio),
        }),
      });
      setCreateOpen(false);
      await fetchAudiences();
    } catch {
      // Error handling
    } finally {
      setCreating(false);
    }
  }

  async function handleEstimate() {
    try {
      const res = await fetch("/api/audiences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "estimate",
          targeting: {
            age_min: parseInt(estimateForm.age_min),
            age_max: parseInt(estimateForm.age_max),
            geo_locations: {
              countries: estimateForm.countries.split(",").map((c) => c.trim()),
            },
          },
        }),
      });
      const data = await res.json();
      setEstimateResult(
        `Estimativa: ${formatNumber(data.estimated_reach || 0)} - ${formatNumber(
          data.estimated_reach_upper || 0
        )} pessoas`
      );
    } catch {
      setEstimateResult("Erro ao estimar");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Audiências</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie suas audiências customizadas e lookalike
          </p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Nova Audiência
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Criar Audiência</DialogTitle>
              <DialogDescription>
                Escolha o tipo de audiência para criar
              </DialogDescription>
            </DialogHeader>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
              <TabsList className="w-full">
                <TabsTrigger value="custom" className="flex-1">
                  Custom
                </TabsTrigger>
                <TabsTrigger value="lookalike" className="flex-1">
                  Lookalike
                </TabsTrigger>
                <TabsTrigger value="estimate" className="flex-1">
                  Estimar
                </TabsTrigger>
              </TabsList>

              <TabsContent value="custom" className="space-y-4 mt-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Nome</label>
                  <Input
                    value={customForm.name}
                    onChange={(e) =>
                      setCustomForm({ ...customForm, name: e.target.value })
                    }
                    placeholder="Nome da audiência"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Descrição
                  </label>
                  <Input
                    value={customForm.description}
                    onChange={(e) =>
                      setCustomForm({
                        ...customForm,
                        description: e.target.value,
                      })
                    }
                    placeholder="Descrição opcional"
                  />
                </div>
                <Button
                  onClick={handleCreateCustom}
                  disabled={!customForm.name || creating}
                  className="w-full"
                >
                  {creating ? "Criando..." : "Criar Audiência Custom"}
                </Button>
              </TabsContent>

              <TabsContent value="lookalike" className="space-y-4 mt-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Nome</label>
                  <Input
                    value={lookalikeForm.name}
                    onChange={(e) =>
                      setLookalikeForm({
                        ...lookalikeForm,
                        name: e.target.value,
                      })
                    }
                    placeholder="Nome da lookalike"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    ID da Audiência Fonte
                  </label>
                  <Input
                    value={lookalikeForm.source_audience_id}
                    onChange={(e) =>
                      setLookalikeForm({
                        ...lookalikeForm,
                        source_audience_id: e.target.value,
                      })
                    }
                    placeholder="ID da audiência base"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium mb-1 block">
                      País
                    </label>
                    <Input
                      value={lookalikeForm.country}
                      onChange={(e) =>
                        setLookalikeForm({
                          ...lookalikeForm,
                          country: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">
                      Ratio (1-10%)
                    </label>
                    <Select
                      value={lookalikeForm.ratio}
                      onValueChange={(v) =>
                        setLookalikeForm({ ...lookalikeForm, ratio: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0.01">1%</SelectItem>
                        <SelectItem value="0.02">2%</SelectItem>
                        <SelectItem value="0.05">5%</SelectItem>
                        <SelectItem value="0.10">10%</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button
                  onClick={handleCreateLookalike}
                  disabled={
                    !lookalikeForm.name ||
                    !lookalikeForm.source_audience_id ||
                    creating
                  }
                  className="w-full"
                >
                  {creating ? "Criando..." : "Criar Lookalike"}
                </Button>
              </TabsContent>

              <TabsContent value="estimate" className="space-y-4 mt-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Países
                  </label>
                  <Input
                    value={estimateForm.countries}
                    onChange={(e) =>
                      setEstimateForm({
                        ...estimateForm,
                        countries: e.target.value,
                      })
                    }
                    placeholder="BR, US"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium mb-1 block">
                      Idade Mín.
                    </label>
                    <Input
                      type="number"
                      value={estimateForm.age_min}
                      onChange={(e) =>
                        setEstimateForm({
                          ...estimateForm,
                          age_min: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">
                      Idade Máx.
                    </label>
                    <Input
                      type="number"
                      value={estimateForm.age_max}
                      onChange={(e) =>
                        setEstimateForm({
                          ...estimateForm,
                          age_max: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                <Button onClick={handleEstimate} className="w-full">
                  Estimar Tamanho
                </Button>
                {estimateResult && (
                  <p className="text-sm text-center text-primary font-medium">
                    {estimateResult}
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>

      {/* Audiences Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="animate-pulse space-y-3">
                  <div className="h-5 w-32 rounded bg-muted" />
                  <div className="h-4 w-48 rounded bg-muted" />
                  <div className="h-4 w-24 rounded bg-muted" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : audiences.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">Nenhuma audiência encontrada</p>
            <p className="text-sm text-muted-foreground mt-1">
              Crie sua primeira audiência customizada
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {audiences.map((audience) => (
            <Card key={audience.id} className="hover:border-primary/20 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-sm font-medium">
                    {audience.name}
                  </CardTitle>
                  <Badge variant="secondary" className="text-xs">
                    {audience.subtype}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {audience.approximate_count !== undefined && (
                    <p className="text-sm text-muted-foreground">
                      Tamanho: {formatNumber(audience.approximate_count)}
                    </p>
                  )}
                  {audience.description && (
                    <p className="text-xs text-muted-foreground truncate">
                      {audience.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        navigator.clipboard.writeText(audience.id)
                      }
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      ID
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

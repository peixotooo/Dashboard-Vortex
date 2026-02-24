"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { PerformanceTable } from "@/components/dashboard/performance-table";
import { useAccount } from "@/lib/account-context";
import type { AdSet, Campaign } from "@/lib/types";

const optimizationGoals = [
  { value: "LINK_CLICKS", label: "Cliques no Link" },
  { value: "LANDING_PAGE_VIEWS", label: "Views na Landing Page" },
  { value: "IMPRESSIONS", label: "Impressões" },
  { value: "REACH", label: "Alcance" },
  { value: "LEAD_GENERATION", label: "Geração de Leads" },
  { value: "OFFSITE_CONVERSIONS", label: "Conversões" },
];

export default function AdSetsPage() {
  const { accountId } = useAccount();
  const [adSets, setAdSets] = useState<AdSet[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCampaign, setSelectedCampaign] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newAdSet, setNewAdSet] = useState({
    campaign_id: "",
    name: "",
    daily_budget: "",
    optimization_goal: "LINK_CLICKS",
    billing_event: "IMPRESSIONS",
    age_min: "18",
    age_max: "65",
    countries: "BR",
  });

  const fetchAdSets = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ account_id: accountId });
      if (selectedCampaign) params.set("campaign_id", selectedCampaign);
      const res = await fetch(`/api/adsets?${params}`);
      const data = await res.json();
      setAdSets(data.ad_sets || []);
    } catch {
      // Keep empty state
    } finally {
      setLoading(false);
    }
  }, [selectedCampaign, accountId]);

  useEffect(() => {
    fetchAdSets();
  }, [fetchAdSets]);

  useEffect(() => {
    if (!accountId) return;
    async function fetchCampaigns() {
      try {
        const res = await fetch(`/api/campaigns?account_id=${accountId}&limit=100`);
        const data = await res.json();
        setCampaigns(data.campaigns || []);
      } catch {
        // Keep empty state
      }
    }
    fetchCampaigns();
  }, [accountId]);

  async function handleCreate() {
    if (!newAdSet.name || !newAdSet.campaign_id) return;

    setCreating(true);
    try {
      await fetch("/api/adsets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: newAdSet.campaign_id,
          name: newAdSet.name,
          daily_budget: newAdSet.daily_budget
            ? parseInt(newAdSet.daily_budget) * 100
            : undefined,
          optimization_goal: newAdSet.optimization_goal,
          billing_event: newAdSet.billing_event,
          targeting: {
            age_min: parseInt(newAdSet.age_min),
            age_max: parseInt(newAdSet.age_max),
            geo_locations: {
              countries: newAdSet.countries.split(",").map((c) => c.trim()),
              location_types: ["home", "recent"],
            },
          },
        }),
      });
      setCreateOpen(false);
      await fetchAdSets();
    } catch {
      // Error handling
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Ad Sets</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie os conjuntos de anúncios
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Filtrar por campanha" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Todas</SelectItem>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Novo Ad Set
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Criar Ad Set</DialogTitle>
                <DialogDescription>
                  Configure os detalhes do conjunto de anúncios
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Campanha
                  </label>
                  <Select
                    value={newAdSet.campaign_id}
                    onValueChange={(v) =>
                      setNewAdSet({ ...newAdSet, campaign_id: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a campanha" />
                    </SelectTrigger>
                    <SelectContent>
                      {campaigns.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Nome</label>
                  <Input
                    value={newAdSet.name}
                    onChange={(e) =>
                      setNewAdSet({ ...newAdSet, name: e.target.value })
                    }
                    placeholder="Nome do ad set"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Orçamento Diário (R$)
                  </label>
                  <Input
                    type="number"
                    value={newAdSet.daily_budget}
                    onChange={(e) =>
                      setNewAdSet({ ...newAdSet, daily_budget: e.target.value })
                    }
                    placeholder="30.00"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Otimização
                  </label>
                  <Select
                    value={newAdSet.optimization_goal}
                    onValueChange={(v) =>
                      setNewAdSet({ ...newAdSet, optimization_goal: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {optimizationGoals.map((g) => (
                        <SelectItem key={g.value} value={g.value}>
                          {g.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium mb-1 block">
                      Idade Mín.
                    </label>
                    <Input
                      type="number"
                      value={newAdSet.age_min}
                      onChange={(e) =>
                        setNewAdSet({ ...newAdSet, age_min: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">
                      Idade Máx.
                    </label>
                    <Input
                      type="number"
                      value={newAdSet.age_max}
                      onChange={(e) =>
                        setNewAdSet({ ...newAdSet, age_max: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Países (separados por vírgula)
                  </label>
                  <Input
                    value={newAdSet.countries}
                    onChange={(e) =>
                      setNewAdSet({ ...newAdSet, countries: e.target.value })
                    }
                    placeholder="BR, US, PT"
                  />
                </div>
                <Button
                  onClick={handleCreate}
                  disabled={
                    !newAdSet.name || !newAdSet.campaign_id || creating
                  }
                  className="w-full"
                >
                  {creating ? "Criando..." : "Criar Ad Set"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <PerformanceTable
        columns={[
          { key: "name", label: "Nome" },
          { key: "status", label: "Status", format: "status" },
          { key: "effective_status", label: "Status Efetivo", format: "status" },
          { key: "optimization_goal", label: "Otimização" },
          { key: "daily_budget", label: "Orçamento/dia", format: "currency", align: "right" },
          { key: "billing_event", label: "Cobrança" },
        ]}
        data={adSets}
        loading={loading}
      />
    </div>
  );
}

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
import type { Ad, Campaign } from "@/lib/types";

export default function AdsPage() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCampaign, setSelectedCampaign] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newAd, setNewAd] = useState({
    name: "",
    adset_id: "",
    creative_id: "",
    status: "PAUSED",
  });

  const fetchAds = useCallback(async () => {
    setLoading(true);
    try {
      const params = selectedCampaign
        ? `?campaign_id=${selectedCampaign}`
        : "";
      const res = await fetch(`/api/ads${params}`);
      const data = await res.json();
      setAds(data.ads || []);
    } catch {
      // Keep empty state
    } finally {
      setLoading(false);
    }
  }, [selectedCampaign]);

  useEffect(() => {
    fetchAds();
  }, [fetchAds]);

  useEffect(() => {
    async function fetchCampaigns() {
      try {
        const res = await fetch("/api/campaigns?limit=100");
        const data = await res.json();
        setCampaigns(data.campaigns || []);
      } catch {
        // Keep empty state
      }
    }
    fetchCampaigns();
  }, []);

  async function handleCreate() {
    if (!newAd.name || !newAd.adset_id || !newAd.creative_id) return;

    setCreating(true);
    try {
      await fetch("/api/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newAd.name,
          adset_id: newAd.adset_id,
          creative: { creative_id: newAd.creative_id },
          status: newAd.status,
        }),
      });
      setCreateOpen(false);
      setNewAd({ name: "", adset_id: "", creative_id: "", status: "PAUSED" });
      await fetchAds();
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
          <h1 className="text-2xl font-bold">Ads</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie seus anúncios individuais
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
                Novo Ad
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Criar Ad</DialogTitle>
                <DialogDescription>
                  Configure os detalhes do anúncio
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Nome</label>
                  <Input
                    value={newAd.name}
                    onChange={(e) =>
                      setNewAd({ ...newAd, name: e.target.value })
                    }
                    placeholder="Nome do anúncio"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Ad Set ID
                  </label>
                  <Input
                    value={newAd.adset_id}
                    onChange={(e) =>
                      setNewAd({ ...newAd, adset_id: e.target.value })
                    }
                    placeholder="ID do ad set"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Creative ID
                  </label>
                  <Input
                    value={newAd.creative_id}
                    onChange={(e) =>
                      setNewAd({ ...newAd, creative_id: e.target.value })
                    }
                    placeholder="ID do criativo"
                  />
                </div>
                <Button
                  onClick={handleCreate}
                  disabled={
                    !newAd.name ||
                    !newAd.adset_id ||
                    !newAd.creative_id ||
                    creating
                  }
                  className="w-full"
                >
                  {creating ? "Criando..." : "Criar Ad"}
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
          { key: "campaign_id", label: "Campanha" },
          { key: "adset_id", label: "Ad Set" },
          { key: "created_time", label: "Criado em" },
        ]}
        data={ads}
        loading={loading}
      />
    </div>
  );
}

"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Plus, Pause, Play, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { getStatusBadgeClasses, formatBudget } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";
import type { Campaign } from "@/lib/types";

const objectives = [
  { value: "OUTCOME_TRAFFIC", label: "Tráfego" },
  { value: "OUTCOME_LEADS", label: "Leads" },
  { value: "OUTCOME_SALES", label: "Vendas" },
  { value: "OUTCOME_AWARENESS", label: "Reconhecimento" },
  { value: "OUTCOME_ENGAGEMENT", label: "Engajamento" },
  { value: "OUTCOME_APP_PROMOTION", label: "Promoção de App" },
];

export default function CampaignsPage() {
  const { accountId } = useAccount();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newCampaign, setNewCampaign] = useState({
    name: "",
    objective: "OUTCOME_TRAFFIC",
    daily_budget: "",
    status: "PAUSED",
  });
  const [filter, setFilter] = useState("");

  const fetchCampaigns = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns?account_id=${accountId}&limit=50`);
      const data = await res.json();
      setCampaigns(data.campaigns || []);
    } catch {
      // Keep empty state
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  async function handleAction(
    action: string,
    campaignId: string
  ) {
    setActionLoading(campaignId);
    try {
      await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, campaign_id: campaignId }),
      });
      await fetchCampaigns();
    } catch {
      // Error handling
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCreate() {
    if (!newCampaign.name) return;

    setActionLoading("create");
    try {
      await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          account_id: accountId,
          name: newCampaign.name,
          objective: newCampaign.objective,
          daily_budget: newCampaign.daily_budget
            ? parseInt(newCampaign.daily_budget) * 100
            : undefined,
          status: newCampaign.status,
          special_ad_categories: ["NONE"],
        }),
      });
      setCreateOpen(false);
      setNewCampaign({
        name: "",
        objective: "OUTCOME_TRAFFIC",
        daily_budget: "",
        status: "PAUSED",
      });
      await fetchCampaigns();
    } catch {
      // Error handling
    } finally {
      setActionLoading(null);
    }
  }

  const filtered = campaigns.filter((c) =>
    c.name?.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Campanhas</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie suas campanhas Meta Ads
          </p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Nova Campanha
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Criar Campanha</DialogTitle>
              <DialogDescription>
                Configure os detalhes da nova campanha
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Nome</label>
                <Input
                  value={newCampaign.name}
                  onChange={(e) =>
                    setNewCampaign({ ...newCampaign, name: e.target.value })
                  }
                  placeholder="Nome da campanha"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Objetivo
                </label>
                <Select
                  value={newCampaign.objective}
                  onValueChange={(v) =>
                    setNewCampaign({ ...newCampaign, objective: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {objectives.map((obj) => (
                      <SelectItem key={obj.value} value={obj.value}>
                        {obj.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Orçamento Diário (R$)
                </label>
                <Input
                  type="number"
                  value={newCampaign.daily_budget}
                  onChange={(e) =>
                    setNewCampaign({
                      ...newCampaign,
                      daily_budget: e.target.value,
                    })
                  }
                  placeholder="50.00"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Status Inicial
                </label>
                <Select
                  value={newCampaign.status}
                  onValueChange={(v) =>
                    setNewCampaign({ ...newCampaign, status: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PAUSED">Pausada</SelectItem>
                    <SelectItem value="ACTIVE">Ativa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleCreate}
                disabled={!newCampaign.name || actionLoading === "create"}
                className="w-full"
              >
                {actionLoading === "create" ? "Criando..." : "Criar Campanha"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filter */}
      <Input
        placeholder="Buscar campanhas..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="max-w-sm"
      />

      {/* Campaigns List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {filtered.length} campanha{filtered.length !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-6">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                      Nome
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                      Objetivo
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                      Orçamento
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-8 text-center text-sm text-muted-foreground"
                      >
                        Nenhuma campanha encontrada
                      </td>
                    </tr>
                  ) : (
                    filtered.map((campaign) => (
                      <tr
                        key={campaign.id}
                        className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-sm font-medium">
                              {campaign.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              ID: {campaign.id}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            className={getStatusBadgeClasses(campaign.status)}
                            variant="outline"
                          >
                            {campaign.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {campaign.objective?.replace("OUTCOME_", "") || "-"}
                        </td>
                        <td className="px-4 py-3 text-right text-sm">
                          {campaign.daily_budget
                            ? `${formatBudget(campaign.daily_budget)}/dia`
                            : campaign.lifetime_budget
                            ? formatBudget(campaign.lifetime_budget)
                            : "-"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {campaign.status === "ACTIVE" ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  handleAction("pause", campaign.id)
                                }
                                disabled={actionLoading === campaign.id}
                                title="Pausar"
                              >
                                <Pause className="h-4 w-4" />
                              </Button>
                            ) : campaign.status === "PAUSED" ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  handleAction("resume", campaign.id)
                                }
                                disabled={actionLoading === campaign.id}
                                title="Retomar"
                              >
                                <Play className="h-4 w-4" />
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Editar"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                handleAction("delete", campaign.id)
                              }
                              disabled={actionLoading === campaign.id}
                              title="Deletar"
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

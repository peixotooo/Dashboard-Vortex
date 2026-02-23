"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Image as ImageIcon, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Creative } from "@/lib/types";

export default function CreativesPage() {
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCreative, setSelectedCreative] = useState<Creative | null>(null);
  const [validationResult, setValidationResult] = useState<Record<string, unknown> | null>(null);
  const [validating, setValidating] = useState(false);

  const fetchCreatives = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/creatives");
      const data = await res.json();
      setCreatives(data.creatives || []);
    } catch {
      // Keep empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCreatives();
  }, [fetchCreatives]);

  async function handleValidate(creativeId: string) {
    setValidating(true);
    try {
      const res = await fetch("/api/creatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validate", creative_id: creativeId }),
      });
      const data = await res.json();
      setValidationResult(data);
    } catch {
      setValidationResult({ error: "Erro ao validar" });
    } finally {
      setValidating(false);
    }
  }

  async function handlePerformance(creativeId: string) {
    try {
      const res = await fetch("/api/creatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "performance",
          creative_id: creativeId,
        }),
      });
      const data = await res.json();
      setValidationResult(data);
    } catch {
      // Error handling
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Criativos</h1>
        <p className="text-sm text-muted-foreground">
          Visualize e gerencie seus criativos de anúncio
        </p>
      </div>

      {/* Creative Detail Dialog */}
      <Dialog
        open={!!selectedCreative}
        onOpenChange={() => {
          setSelectedCreative(null);
          setValidationResult(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedCreative?.name || "Criativo"}</DialogTitle>
            <DialogDescription>
              ID: {selectedCreative?.id}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            {selectedCreative?.image_url && (
              <img
                src={selectedCreative.image_url}
                alt={selectedCreative.name}
                className="w-full rounded-lg border border-border"
              />
            )}
            {selectedCreative?.title && (
              <div>
                <p className="text-xs text-muted-foreground">Título</p>
                <p className="text-sm">{selectedCreative.title}</p>
              </div>
            )}
            {selectedCreative?.body && (
              <div>
                <p className="text-xs text-muted-foreground">Texto</p>
                <p className="text-sm">{selectedCreative.body}</p>
              </div>
            )}
            {selectedCreative?.call_to_action_type && (
              <div>
                <p className="text-xs text-muted-foreground">CTA</p>
                <Badge variant="secondary">
                  {selectedCreative.call_to_action_type}
                </Badge>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  selectedCreative && handleValidate(selectedCreative.id)
                }
                disabled={validating}
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                {validating ? "Validando..." : "Validar"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  selectedCreative && handlePerformance(selectedCreative.id)
                }
              >
                Performance
              </Button>
            </div>

            {validationResult && (
              <Card>
                <CardContent className="p-4">
                  <pre className="text-xs whitespace-pre-wrap overflow-auto max-h-48">
                    {JSON.stringify(validationResult, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Creatives Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="animate-pulse space-y-3">
                  <div className="h-40 rounded bg-muted" />
                  <div className="h-4 w-32 rounded bg-muted" />
                  <div className="h-3 w-24 rounded bg-muted" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : creatives.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <ImageIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">Nenhum criativo encontrado</p>
            <p className="text-sm text-muted-foreground mt-1">
              Criativos aparecerão aqui quando forem criados
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {creatives.map((creative) => (
            <Card
              key={creative.id}
              className="cursor-pointer hover:border-primary/20 transition-colors"
              onClick={() => setSelectedCreative(creative)}
            >
              <CardContent className="p-4">
                {creative.image_url || creative.thumbnail_url ? (
                  <img
                    src={creative.thumbnail_url || creative.image_url}
                    alt={creative.name}
                    className="w-full h-40 object-cover rounded-lg mb-3 bg-muted"
                  />
                ) : (
                  <div className="w-full h-40 rounded-lg mb-3 bg-muted flex items-center justify-center">
                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <p className="text-sm font-medium truncate">
                  {creative.name || `Criativo ${creative.id}`}
                </p>
                {creative.call_to_action_type && (
                  <Badge variant="secondary" className="mt-2 text-xs">
                    {creative.call_to_action_type}
                  </Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

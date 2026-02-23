"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, type LucideIcon } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: string;
  change?: number;
  icon: LucideIcon;
  iconColor?: string;
  loading?: boolean;
}

export function KpiCard({
  title,
  value,
  change,
  icon: Icon,
  iconColor = "text-primary",
  loading = false,
}: KpiCardProps) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-8 w-32 rounded bg-muted" />
            <div className="h-3 w-16 rounded bg-muted" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover:border-primary/20 transition-colors">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className={cn("rounded-lg bg-muted p-2", iconColor)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-3">
          <p className="text-2xl font-bold">{value}</p>
          {change !== undefined && (
            <div className="mt-1 flex items-center gap-1">
              {change >= 0 ? (
                <TrendingUp className="h-3 w-3 text-success" />
              ) : (
                <TrendingDown className="h-3 w-3 text-destructive" />
              )}
              <span
                className={cn(
                  "text-xs font-medium",
                  change >= 0 ? "text-success" : "text-destructive"
                )}
              >
                {change >= 0 ? "+" : ""}
                {change.toFixed(1)}%
              </span>
              <span className="text-xs text-muted-foreground">
                vs per. anterior
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

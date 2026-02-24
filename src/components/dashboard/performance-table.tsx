"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatBudget, formatNumber, formatPercent, getStatusBadgeClasses } from "@/lib/utils";

interface Column {
  key: string;
  label: string;
  format?: "currency" | "budget" | "number" | "percent" | "status" | "text";
  align?: "left" | "right" | "center";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface PerformanceTableProps {
  title?: string;
  columns: Column[];
  data: Array<Record<string, any>>;
  loading?: boolean;
  onRowClick?: (row: Record<string, any>) => void;
  actions?: (row: Record<string, any>) => React.ReactNode;
}

function formatCell(value: unknown, format?: string): React.ReactNode {
  const strValue = String(value ?? "");
  switch (format) {
    case "currency":
      return formatCurrency(strValue);
    case "budget":
      return formatBudget(strValue);
    case "number":
      return formatNumber(strValue);
    case "percent":
      return formatPercent(strValue);
    case "status":
      return (
        <Badge className={getStatusBadgeClasses(strValue)} variant="outline">
          {strValue}
        </Badge>
      );
    default:
      return strValue;
  }
}

export function PerformanceTable({
  title,
  columns,
  data,
  loading = false,
  onRowClick,
  actions,
}: PerformanceTableProps) {
  if (loading) {
    return (
      <Card>
        {title && (
          <CardHeader>
            <CardTitle className="text-base">{title}</CardTitle>
          </CardHeader>
        )}
        <CardContent>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {title && (
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider ${
                      col.align === "right"
                        ? "text-right"
                        : col.align === "center"
                        ? "text-center"
                        : "text-left"
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
                {actions && (
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider text-right">
                    Ações
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + (actions ? 1 : 0)}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    Nenhum dado encontrado
                  </td>
                </tr>
              ) : (
                data.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-b border-border/50 transition-colors hover:bg-muted/30 ${
                      onRowClick ? "cursor-pointer" : ""
                    }`}
                    onClick={() => onRowClick?.(row)}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-4 py-3 text-sm ${
                          col.align === "right"
                            ? "text-right"
                            : col.align === "center"
                            ? "text-center"
                            : "text-left"
                        }`}
                      >
                        {formatCell(row[col.key], col.format)}
                      </td>
                    ))}
                    {actions && (
                      <td className="px-4 py-3 text-right">
                        {actions(row)}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

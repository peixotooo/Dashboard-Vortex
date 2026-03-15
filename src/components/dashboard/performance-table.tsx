"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatCurrency, formatBudget, formatNumber, formatPercent, getStatusBadgeClasses } from "@/lib/utils";

interface Column {
  key: string;
  label: string;
  format?: "currency" | "budget" | "number" | "percent" | "status" | "text";
  align?: "left" | "right" | "center";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render?: (value: unknown, row: Record<string, any>) => React.ReactNode;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface PerformanceTableProps {
  title?: string;
  columns: Column[];
  data: Array<Record<string, any>>;
  loading?: boolean;
  onRowClick?: (row: Record<string, any>) => void;
  actions?: (row: Record<string, any>) => React.ReactNode;
  highlightKey?: string;
  selectedSet?: Set<string>;
  selectedKey?: string;
  sortable?: boolean;
  pageSize?: number;
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
  highlightKey,
  selectedSet,
  selectedKey,
  sortable = false,
  pageSize,
}: PerformanceTableProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  // Reset to page 0 when data changes (filter/search applied)
  const dataLen = data.length;
  useEffect(() => {
    setPage(0);
  }, [dataLen]);

  const sortedData = useMemo(() => {
    if (!sortable || !sortKey) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortKey] ?? 0;
      const bVal = b[sortKey] ?? 0;
      const aNum = typeof aVal === "number" ? aVal : parseFloat(String(aVal)) || 0;
      const bNum = typeof bVal === "number" ? bVal : parseFloat(String(bVal)) || 0;
      return sortDir === "desc" ? bNum - aNum : aNum - bNum;
    });
  }, [data, sortKey, sortDir, sortable]);

  const totalPages = pageSize ? Math.ceil(sortedData.length / pageSize) : 1;
  const paginatedData = pageSize
    ? sortedData.slice(page * pageSize, (page + 1) * pageSize)
    : sortedData;

  function isRowHighlighted(row: Record<string, unknown>): boolean {
    if (selectedSet && selectedKey) {
      return selectedSet.has(String(row[selectedKey]));
    }
    if (highlightKey) {
      return !!row[highlightKey];
    }
    return false;
  }

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
                    } ${sortable ? "cursor-pointer select-none hover:text-foreground transition-colors" : ""}`}
                    onClick={() => {
                      if (!sortable) return;
                      if (sortKey === col.key) {
                        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
                      } else {
                        setSortKey(col.key);
                        setSortDir("desc");
                      }
                    }}
                  >
                    <span className={`inline-flex items-center gap-1 ${col.align === "right" ? "justify-end" : ""}`}>
                      {col.label}
                      {sortable && sortKey === col.key && (
                        <span className="text-[10px]">{sortDir === "desc" ? "▼" : "▲"}</span>
                      )}
                    </span>
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
              {paginatedData.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + (actions ? 1 : 0)}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    Nenhum dado encontrado
                  </td>
                </tr>
              ) : (
                paginatedData.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-b border-border/50 transition-colors hover:bg-muted/30 ${
                      onRowClick ? "cursor-pointer" : ""
                    } ${isRowHighlighted(row) ? "bg-primary/10" : ""}`}
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
                        {col.render ? col.render(row[col.key], row) : formatCell(row[col.key], col.format)}
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

        {/* Pagination footer */}
        {pageSize && sortedData.length > pageSize && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm text-muted-foreground">
            <span>
              Mostrando {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sortedData.length)} de{" "}
              {sortedData.length.toLocaleString("pt-BR")}
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </button>
              <span className="px-3 py-1.5 text-sm">
                {page + 1} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Proximo
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

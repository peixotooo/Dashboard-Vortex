"use client";

import { useTheme } from "next-themes";
import { useMemo } from "react";

const LIGHT = {
  grid: "#e4e4e7",
  axis: "#71717a",
  tooltipStyle: {
    backgroundColor: "#ffffff",
    border: "1px solid #e4e4e7",
    borderRadius: "8px",
    color: "#09090b",
    fontSize: "12px",
  } as React.CSSProperties,
  series: [
    "#6366f1",
    "#22c55e",
    "#f97316",
    "#8b5cf6",
    "#ef4444",
    "#06b6d4",
    "#f59e0b",
    "#ec4899",
  ],
};

const DARK = {
  grid: "#27272a",
  axis: "#a1a1aa",
  tooltipStyle: {
    backgroundColor: "#0a0a0f",
    border: "1px solid #27272a",
    borderRadius: "8px",
    color: "#fafafa",
    fontSize: "12px",
  } as React.CSSProperties,
  series: [
    "#818cf8",
    "#34d399",
    "#fb923c",
    "#a78bfa",
    "#f87171",
    "#22d3ee",
    "#fbbf24",
    "#f472b6",
  ],
};

export function useChartTheme() {
  const { resolvedTheme } = useTheme();
  return useMemo(
    () => (resolvedTheme === "light" ? LIGHT : DARK),
    [resolvedTheme]
  );
}

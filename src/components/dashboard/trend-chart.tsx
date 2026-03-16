"use client";

import React from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useChartTheme } from "@/hooks/use-chart-theme";

interface TrendChartProps {
  title: string;
  data: Array<Record<string, unknown>>;
  lines: Array<{
    key: string;
    label: string;
    color: string;
  }>;
  loading?: boolean;
}

export function TrendChart({ title, data, lines, loading = false }: TrendChartProps) {
  const chart = useChartTheme();

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <defs>
                {lines.map((line) => (
                  <linearGradient
                    key={line.key}
                    id={`gradient-${line.key}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor={line.color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={line.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
              <XAxis
                dataKey="date"
                stroke={chart.axis}
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke={chart.axis}
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip contentStyle={chart.tooltipStyle} />
              <Legend />
              {lines.map((line) => (
                <Area
                  key={line.key}
                  type="monotone"
                  dataKey={line.key}
                  name={line.label}
                  stroke={line.color}
                  fill={`url(#gradient-${line.key})`}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

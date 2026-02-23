"use client";

import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DatePreset } from "@/lib/types";

const datePresets: { value: DatePreset; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last_7d", label: "Últimos 7 dias" },
  { value: "last_14d", label: "Últimos 14 dias" },
  { value: "last_30d", label: "Últimos 30 dias" },
  { value: "last_90d", label: "Últimos 90 dias" },
  { value: "this_month", label: "Este mês" },
  { value: "last_month", label: "Mês passado" },
];

interface DateRangePickerProps {
  value: DatePreset;
  onChange: (value: DatePreset) => void;
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as DatePreset)}>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="Selecione o período" />
      </SelectTrigger>
      <SelectContent>
        {datePresets.map((preset) => (
          <SelectItem key={preset.value} value={preset.value}>
            {preset.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

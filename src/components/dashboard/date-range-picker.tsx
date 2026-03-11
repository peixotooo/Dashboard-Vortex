"use client";

import React, { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { DatePreset } from "@/lib/types";
import type { DateRange } from "react-day-picker";

const datePresets: { value: DatePreset; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last_7d", label: "Últimos 7 dias" },
  { value: "last_14d", label: "Últimos 14 dias" },
  { value: "last_30d", label: "Últimos 30 dias" },
  { value: "last_90d", label: "Últimos 90 dias" },
  { value: "this_month", label: "Este mês" },
  { value: "last_month", label: "Mês passado" },
  { value: "custom", label: "Personalizado" },
];

interface DateRangePickerProps {
  value: DatePreset;
  onChange: (value: DatePreset) => void;
  customRange?: { since: string; until: string };
  onCustomRangeChange?: (range: { since: string; until: string }) => void;
}

export function DateRangePicker({
  value,
  onChange,
  customRange,
  onCustomRangeChange,
}: DateRangePickerProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [pendingRange, setPendingRange] = useState<DateRange | undefined>(
    customRange
      ? { from: new Date(customRange.since + "T00:00:00"), to: new Date(customRange.until + "T00:00:00") }
      : undefined
  );

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const handlePresetChange = (v: string) => {
    if (v === "custom") {
      setCalendarOpen(true);
      return;
    }
    onChange(v as DatePreset);
  };

  const handleRangeSelect = (range: DateRange | undefined) => {
    setPendingRange(range);
    if (range?.from && range?.to) {
      const newRange = { since: fmt(range.from), until: fmt(range.to) };
      onCustomRangeChange?.(newRange);
      onChange("custom");
      setCalendarOpen(false);
    }
  };

  const displayLabel = value === "custom" && customRange
    ? `${format(new Date(customRange.since + "T00:00:00"), "dd MMM", { locale: ptBR })} - ${format(new Date(customRange.until + "T00:00:00"), "dd MMM yyyy", { locale: ptBR })}`
    : undefined;

  return (
    <div className="flex items-center gap-2">
      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <div className="relative">
          <Select value={value} onValueChange={handlePresetChange}>
            <SelectTrigger className={value === "custom" && displayLabel ? "w-64" : "w-48"}>
              <SelectValue placeholder="Selecione o período">
                {displayLabel || datePresets.find((p) => p.value === value)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {datePresets.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {preset.value === "custom" ? (
                    <span className="flex items-center gap-2">
                      <CalendarIcon className="h-3.5 w-3.5" />
                      {preset.label}
                    </span>
                  ) : (
                    preset.label
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <PopoverTrigger asChild>
          <span />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            selected={pendingRange}
            onSelect={handleRangeSelect}
            numberOfMonths={2}
            disabled={{ after: new Date() }}
            defaultMonth={pendingRange?.from || new Date()}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

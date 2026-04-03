"use client";

import React, { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, ChevronDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import type { DatePreset } from "@/lib/types";
import type { DateRange } from "react-day-picker";

const datePresets: { value: DatePreset; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last_3d", label: "Últimos 3 dias" },
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
  customRange?: { since: string; until: string };
  onCustomRangeChange?: (range: { since: string; until: string }) => void;
}

export function DateRangePicker({
  value,
  onChange,
  customRange,
  onCustomRangeChange,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [pendingRange, setPendingRange] = useState<DateRange | undefined>(
    customRange
      ? { from: new Date(customRange.since + "T00:00:00"), to: new Date(customRange.until + "T00:00:00") }
      : undefined
  );

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const handlePresetClick = (preset: DatePreset) => {
    onChange(preset);
    setShowCalendar(false);
    setOpen(false);
  };

  const handleApply = () => {
    if (pendingRange?.from && pendingRange?.to) {
      const newRange = { since: fmt(pendingRange.from), until: fmt(pendingRange.to) };
      onCustomRangeChange?.(newRange);
      onChange("custom");
      setShowCalendar(false);
      setOpen(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) setShowCalendar(false);
  };

  const rangeIsComplete = !!(pendingRange?.from && pendingRange?.to);

  const pendingLabel = pendingRange?.from
    ? pendingRange.to
      ? `${format(pendingRange.from, "dd MMM yyyy", { locale: ptBR })} - ${format(pendingRange.to, "dd MMM yyyy", { locale: ptBR })}`
      : `${format(pendingRange.from, "dd MMM yyyy", { locale: ptBR })} - ...`
    : null;

  const displayLabel = value === "custom" && customRange
    ? `${format(new Date(customRange.since + "T00:00:00"), "dd MMM", { locale: ptBR })} - ${format(new Date(customRange.until + "T00:00:00"), "dd MMM yyyy", { locale: ptBR })}`
    : datePresets.find((p) => p.value === value)?.label ?? "Selecione o período";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 h-10 text-sm text-foreground",
            "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors",
            value === "custom" && customRange ? "w-64" : "w-48"
          )}
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0" align="end">
        {showCalendar ? (
          <div className="flex flex-col">
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <button
                onClick={() => setShowCalendar(false)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                &larr; Voltar
              </button>
              {pendingLabel && (
                <span className="text-xs font-medium text-foreground">{pendingLabel}</span>
              )}
              {!pendingLabel && (
                <span className="text-xs text-muted-foreground">Selecione o intervalo</span>
              )}
            </div>
            <Calendar
              mode="range"
              selected={pendingRange}
              onSelect={setPendingRange}
              numberOfMonths={2}
              disabled={{ after: new Date() }}
              defaultMonth={
                pendingRange?.from ||
                new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)
              }
            />
            <div className="flex justify-end px-4 pb-3 pt-1 gap-2">
              <button
                onClick={() => { setShowCalendar(false); setOpen(false); }}
                className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleApply}
                disabled={!rangeIsComplete}
                className={cn(
                  "px-4 py-1.5 text-sm rounded-md font-medium transition-colors",
                  rangeIsComplete
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                Aplicar
              </button>
            </div>
          </div>
        ) : (
          <div className="py-1 min-w-[180px]">
            {datePresets.map((preset) => (
              <button
                key={preset.value}
                onClick={() => handlePresetClick(preset.value)}
                className={cn(
                  "flex items-center w-full px-3 py-2 text-sm transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  value === preset.value && "font-medium"
                )}
              >
                <span className="w-5 shrink-0">
                  {value === preset.value && <Check className="h-3.5 w-3.5" />}
                </span>
                {preset.label}
              </button>
            ))}
            <div className="border-t border-border my-1" />
            <button
              onClick={() => setShowCalendar(true)}
              className={cn(
                "flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                value === "custom" && "font-medium"
              )}
            >
              <span className="w-5 shrink-0">
                {value === "custom" && <Check className="h-3.5 w-3.5" />}
              </span>
              <CalendarIcon className="h-3.5 w-3.5" />
              Personalizado
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

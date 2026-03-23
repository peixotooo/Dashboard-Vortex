"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Clock, Send } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface SchedulePickerProps {
  value: Date | null;
  onChange: (date: Date | null) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) =>
  i.toString().padStart(2, "0")
);
const MINUTES = ["00", "15", "30", "45"];

export function SchedulePicker({ value, onChange }: SchedulePickerProps) {
  const [mode, setMode] = useState<"now" | "schedule">(
    value ? "schedule" : "now"
  );
  const [date, setDate] = useState<Date | undefined>(value || undefined);
  const [hour, setHour] = useState(value ? format(value, "HH") : "09");
  const [minute, setMinute] = useState(
    value ? MINUTES.reduce((a, b) =>
      Math.abs(parseInt(b) - (value?.getMinutes() || 0)) <
      Math.abs(parseInt(a) - (value?.getMinutes() || 0))
        ? b
        : a
    ) : "00"
  );

  useEffect(() => {
    if (mode === "now") {
      onChange(null);
      return;
    }
    if (date) {
      const d = new Date(date);
      d.setHours(parseInt(hour), parseInt(minute), 0, 0);
      onChange(d);
    }
  }, [mode, date, hour, minute]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button
          type="button"
          variant={mode === "now" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("now")}
          className="flex-1"
        >
          <Send className="h-3.5 w-3.5 mr-1.5" />
          Enviar agora
        </Button>
        <Button
          type="button"
          variant={mode === "schedule" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("schedule")}
          className="flex-1"
        >
          <Clock className="h-3.5 w-3.5 mr-1.5" />
          Agendar
        </Button>
      </div>

      {mode === "schedule" && (
        <div className="flex items-center gap-2 flex-wrap">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-[180px] justify-start text-left font-normal"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {date
                  ? format(date, "dd/MM/yyyy", { locale: ptBR })
                  : "Selecionar data"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d) => d && setDate(d)}
                disabled={(d) => d < today}
                locale={ptBR}
              />
            </PopoverContent>
          </Popover>

          <div className="flex items-center gap-1">
            <select
              value={hour}
              onChange={(e) => setHour(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground">:</span>
            <select
              value={minute}
              onChange={(e) => setMinute(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              {MINUTES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {value && (
            <span className="text-xs text-muted-foreground">
              {format(value, "dd/MM/yyyy 'as' HH:mm", { locale: ptBR })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
